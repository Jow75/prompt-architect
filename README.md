# Prompt Architect

A clean **AI image-prompt builder**. Fill in a few fields and it assembles a polished,
copy-ready prompt. Enhance it with AI into a richer description, generate a preview
image, then use the prompt here or in any AI art tool (Midjourney, Stable Diffusion, etc.).

Image previews are generated with **NVIDIA FLUX** (Black Forest Labs) — free to use with
an `nvapi-` key. Text/enhancement runs on NVIDIA Llama, with optional Gemini / OpenAI fallback.

## Features

- **Structured prompt builder** — subject, scene, style, camera, and negative-prompt fields.
- **One clean prompt** — comma-separated and copy-ready, no tool-specific syntax.
- **Enhance with AI** — expands your fields into a detailed, vivid prompt paragraph.
- **Preview image** — generate and download a FLUX image from your prompt.
- **Resilient multi-provider backend** (NVIDIA → OpenAI → Gemini) with automatic fallback.

## Architecture

- **Frontend:** Vite + React SPA (built to `dist/`).
- **API:** `/api/generate-description` (enhance) and `/api/generate-image`. The provider
  logic lives once in [api/handlers.ts](api/handlers.ts), shared by:
  - **Local dev:** an Express server ([server.ts](server.ts)) via Vite middleware.
  - **Production:** Netlify serverless functions in [netlify/functions/](netlify/functions/).

API keys are only ever used server-side; the client just calls `/api/*`.

## Run locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copy `.env.example` to `.env.local` and set at least `NVIDIA_API_KEY=nvapi-...`.
3. `npm run dev` → <http://localhost:3000>

## Deploy to Netlify

Already configured via [netlify.toml](netlify.toml). Set env vars in Netlify
(**Site configuration → Environment variables**): `NVIDIA_API_KEY` (required),
`OPENAI_API_KEY` / `GEMINI_API_KEY` (optional).

```bash
npm run build            # build the SPA locally
netlify deploy --prod    # deploy (no build minutes used)
```

or `netlify deploy --build --prod` to build on Netlify.

## Notes

- NVIDIA's hosted FLUX applies a safety filter; prompts it flags as explicit return a
  blocked frame, which the app surfaces as a clear message. This tool is intended for
  safe-for-work image prompts.
- Serverless functions cap at 10s (free) / 26s (paid); the default `flux.1-schnell` is
  fast (~2–4s). Set `NVIDIA_IMAGE_MODEL=flux.1-dev` for higher quality on a longer timeout.
