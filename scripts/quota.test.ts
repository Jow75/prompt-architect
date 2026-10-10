// Offline tests for the pieces that can be checked without Netlify or network:
// quota limits under parallel requests, origin rules, input validation and the
// time budget. Run with: npm test

import assert from "node:assert/strict";
import { reserveDailyQuota, checkRateLimit, isAllowedOrigin, type MarkerStore } from "../api/access";
import { validateImageInput, validateDescriptionInput } from "../api/handlers";
import { createDeadline } from "../api/deadline";

// In-memory store with random delays, so parallel callers really do interleave.
function memoryStore(): MarkerStore & { count(prefix: string): number } {
  const keys = new Set<string>();
  const pause = () => new Promise((r) => setTimeout(r, Math.random() * 8));
  return {
    count: (prefix) => [...keys].filter((k) => k.startsWith(prefix)).length,
    async add(key) {
      await pause();
      keys.add(key);
    },
    async remove(key) {
      await pause();
      keys.delete(key);
    },
    async list(prefix) {
      await pause();
      return [...keys].filter((k) => k.startsWith(prefix));
    },
  };
}

const results: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (err: any) {
    results.push(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

const today = new Date().toISOString().slice(0, 10);
const prefix = `img:user:${today}:`;
const reserve = (store: MarkerStore, limit: number) => reserveDailyQuota("user", "img", limit, store);

await test("4 parallel requests at 29/30 never exceed 30", async () => {
  for (let round = 0; round < 25; round++) {
    const store = memoryStore();
    for (let i = 0; i < 29; i++) await reserve(store, 30);
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => reserve(store, 30)));
    assert.ok(outcomes.filter((o) => o.ok).length <= 1, "more than one request passed at 29/30");
    assert.ok(store.count(prefix) <= 30);
  }
});

await test("20 parallel requests never exceed a limit of 5", async () => {
  for (let round = 0; round < 25; round++) {
    const store = memoryStore();
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => reserve(store, 5)));
    const allowed = outcomes.filter((o) => o.ok).length;
    assert.ok(allowed <= 5, `${allowed} allowed with a limit of 5`);
    assert.equal(store.count(prefix), allowed);
  }
});

await test("sequential requests fill the quota exactly", async () => {
  const store = memoryStore();
  let allowed = 0;
  for (let i = 0; i < 8; i++) if ((await reserve(store, 5)).ok) allowed++;
  assert.equal(allowed, 5);
});

await test("releasing a reservation gives the unit back, once", async () => {
  const store = memoryStore();
  const reservation = await reserve(store, 30);
  assert.equal(store.count(prefix), 1);
  await reservation.release();
  await reservation.release();
  assert.equal(store.count(prefix), 0);
});

await test("a refused reservation does not change the count", async () => {
  const store = memoryStore();
  await reserve(store, 1);
  const refused = await reserve(store, 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  await refused.release();
  assert.equal(store.count(prefix), 1);
});

await test("markers from earlier days are cleaned up and do not count", async () => {
  const store = memoryStore();
  for (let i = 0; i < 5; i++) await store.add(`img:user:2020-01-01:old-${i}`);
  assert.equal((await reserve(store, 3)).ok, true);
  assert.equal(store.count("img:user:2020-01-01:"), 0);
});

await test("hourly rate limit blocks at the limit", async () => {
  const store = memoryStore();
  assert.equal((await checkRateLimit("1.2.3.4", "img", 2, store)).ok, true);
  assert.equal((await checkRateLimit("1.2.3.4", "img", 2, store)).ok, true);
  assert.equal((await checkRateLimit("1.2.3.4", "img", 2, store)).ok, false);
});

await test("a broken store fails open", async () => {
  const broken: MarkerStore = {
    add: async () => {
      throw new Error("store down");
    },
    remove: async () => {},
    list: async () => [],
  };
  assert.equal((await reserve(broken, 30)).ok, true);
});

await test("origin rules", () => {
  const origin = (o?: string) => isAllowedOrigin({ headers: o ? { origin: o } : {} });
  assert.equal(origin("https://si-prompt-architect.netlify.app"), true);
  assert.equal(origin("https://deploy-preview-3--si-prompt-architect.netlify.app"), true);
  assert.equal(origin("http://localhost:3000"), true);
  assert.equal(origin(undefined), true);
  assert.equal(origin("https://someone-else.netlify.app"), false);
  assert.equal(origin("https://evil--si-prompt-architect.netlify.app.evil.com"), false);
  assert.equal(origin("not a url"), false);
});

await test("image input validation", () => {
  assert.equal(validateImageInput({ prompt: "a fox" }).ok, true);
  assert.equal(validateImageInput({ prompt: "a fox", model: "flux.1-dev", aspectRatio: "16:9", seed: 7 }).ok, true);
  assert.equal(validateImageInput({ prompt: "   " }).ok, false);
  assert.equal(validateImageInput({ prompt: "x".repeat(4001) }).ok, false);
  assert.equal(validateImageInput({ prompt: "a fox", model: "dall-e-3" }).ok, false);
  assert.equal(validateImageInput({ prompt: "a fox", model: "flux.1-schnell" }).ok, false);
  assert.equal(validateImageInput({ prompt: "a fox", aspectRatio: "5:1" }).ok, false);
  assert.equal(validateImageInput({ prompt: "a fox", seed: -1 }).ok, false);
  assert.equal(validateImageInput(null).ok, false);
});

await test("text input validation", () => {
  assert.equal(validateDescriptionInput({ prompt: "a fox" }).ok, true);
  assert.equal(validateDescriptionInput({ prompt: "a fox", model: "openai/gpt-oss-20b", task: "edit" }).ok, true);
  assert.equal(validateDescriptionInput({ prompt: "a fox", model: "gemini-2.5-flash" }).ok, false);
  assert.equal(validateDescriptionInput({ prompt: "" }).ok, false);
});

await test("deadline never hands out more time than is left", async () => {
  const deadline = createDeadline(200);
  assert.ok(deadline.remaining() <= 200);
  const started = Date.now();
  await new Promise<void>((resolve) => {
    // AbortSignal.timeout does not keep the process alive on its own.
    const keepAlive = setTimeout(resolve, 5000);
    deadline.signal(10_000, 100).addEventListener("abort", () => {
      clearTimeout(keepAlive);
      resolve();
    });
  });
  const waited = Date.now() - started;
  assert.ok(waited < 200, `aborted after ${waited}ms, expected about 100ms`);
});

console.log(results.join("\n"));
