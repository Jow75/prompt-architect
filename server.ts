import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { handleGenerateDescription, handleGenerateImage } from "./api/handlers";

// Load environment variables from .env.local or .env
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;

// The actual provider logic lives in api/handlers.ts so it can be shared with
// the Netlify serverless functions (netlify/functions/*). These Express routes
// are only used for local development (`npm run dev`).

// 1. Scene description generation
app.post("/api/generate-description", async (req, res) => {
  const result = await handleGenerateDescription(req.body || {});
  res.status(result.status).json(result.body);
});

// 2. Image generation
app.post("/api/generate-image", async (req, res) => {
  const result = await handleGenerateImage(req.body || {});
  res.status(result.status).json(result.body);
});

// Configure Vite (dev) or static file serving (production single-server mode)
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");

    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully started on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Server boot failed:", err);
});
