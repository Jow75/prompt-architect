import fetch from "node-fetch"; // or just regular global fetch if on Node 18+

async function run() {
  try {
    const prompt = encodeURIComponent("A beautiful futuristic city, cinematic photography");
    const url = `https://image.pollinations.ai/prompt/${prompt}`;
    console.log("Fetching from:", url);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log("Successfully fetched image buffer from Pollinations! Size:", buffer.length);
    console.log("Base64 preview:", buffer.toString("base64").substring(0, 100));
  } catch (err: any) {
    console.error("Pollinations error:", err.message);
  }
}

run();
