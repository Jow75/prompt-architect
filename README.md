# Prompt Architect

A clean **AI image-prompt builder**. Fill in a few fields and it assembles a polished,
copy-ready prompt. Enhance it with AI into a richer description, generate a preview
image, then use the prompt here or in any AI art tool (Midjourney, Stable Diffusion, etc.).

Everything runs on **NVIDIA-hosted models** with one `nvapi-` key: image previews on
FLUX (Black Forest Labs), prompt enhancement on Nemotron / GPT-OSS / Llama.

## Features

- **Structured prompt builder** — subject, scene, style, camera, and negative-prompt fields.
- **One clean prompt** — comma-separated and copy-ready, no tool-specific syntax.
- **Enhance with AI** — expands your fields into a PROMPT / NEGATIVE PROMPT / TIPS package.
- **Preview image** — generate and download FLUX images (1–4 variations) from your prompt.
- **Photo editing prompt** — writes a ready-to-paste editing prompt for use in an image
  editor. It does not edit images itself; the reference photo stays in your browser.
- **Sign-in required** — Supabase Auth (email + Google); the API verifies every request.

## Architecture

- **Frontend:** Vite + React SPA (built to `dist/`).
- **API:** `POST /api/generate-description` and `POST /api/generate-image`.
  - **Production:** Netlify Functions in [netlify/functions/](netlify/functions/), which run
    the shared pipeline in [api/guard.ts](api/guard.ts): origin check → token check →
    input validation → hourly cap → daily quota → handler.
  - **Local dev:** an Express server ([server.ts](server.ts)) with Vite middleware. It applies
    the origin and token checks but **not** the hourly cap or daily quota.
- **Provider logic:** [api/handlers.ts](api/handlers.ts) (text) and
  [api/providers/](api/providers/) (images).

API keys are only ever used server-side; the client just calls `/api/*`.

### Time budget

Netlify terminates synchronous functions on this site after about **30 seconds** (measured;
it cannot be raised from `netlify.toml`). Every request therefore gets a single **25-second
budget** ([api/deadline.ts](api/deadline.ts)) and each upstream call must fit inside what is
left of it. Slow models return a clear "try again" error instead of a gateway 504.

### Models

| Use | Model | Typical time | Notes |
|---|---|---|---|
| Image (Auto) | `flux.2-klein-4b` | 3–6 s | One retry on a transient failure |
| Image | `flux.1-dev` | 7–30 s | Single attempt; can run out of time |
| Text (Auto) | `nvidia/nemotron-3-super-120b-a12b` | 2–3 s | Reasoning off |
| Text (hedge) | `openai/gpt-oss-20b` | 10–17 s | Started if the first model is slow or fails |
| Text | `meta/llama-3.2-11b-vision-instruct` | 10–28 s | Manual choice only |

To change the lists, edit `TEXT_MODELS` in [api/handlers.ts](api/handlers.ts), `MODELS` in
[api/providers/nvidia.ts](api/providers/nvidia.ts), and the menus in [App.tsx](App.tsx).

### Limits

30 images and 60 enhancements per user per UTC day; 40 and 80 per IP per hour. Stored in
Netlify Blobs ([api/access.ts](api/access.ts)). A request that fails does not use up quota.

## Run locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copy `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase project authentication)
   - `NVIDIA_API_KEY=nvapi-...`
3. `npm run dev` → <http://localhost:3000>

### Checks

```bash
npm run typecheck        # TypeScript
npm test                 # offline: quota, origin rules, validation, time budget
npm run smoke            # live: real NVIDIA calls through the handlers (uses your key)
npm run smoke -- --full  # also the slower models
```

## Deploy to Netlify

Production runs at <https://si-prompt-architect.netlify.app/> and is configured by
[netlify.toml](netlify.toml). Pushing to `main` builds and deploys automatically.

Environment variables (**Site configuration → Environment variables**):

- `VITE_SUPABASE_URL` (required)
- `VITE_SUPABASE_ANON_KEY` (required)
- `NVIDIA_API_KEY` (required)

The free plan includes 300 credits a month and each **production deploy costs 15**, so batch
changes. Draft deploys are free and are the place to test:

```bash
npm run build
netlify deploy --no-build --dir=dist --functions=netlify/functions   # draft URL, 0 credits
```

## Notes

- NVIDIA's hosted FLUX applies a safety filter; prompts it flags return a blocked frame,
  which the app surfaces as a clear message. This tool is intended for safe-for-work prompts.
- FLUX does not accept negative prompts. The negative-prompt field is part of the
  copy-ready prompt for other tools and is not sent to the preview.
- Supabase pauses free projects after about a week without activity, which stops sign-in
  until the project is restored from the Supabase dashboard.
