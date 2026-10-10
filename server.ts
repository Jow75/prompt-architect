import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { handleGenerateDescription, handleGenerateImage } from "./api/handlers";
import { verifyAuth } from "./api/auth";
import { isAllowedOrigin } from "./api/access";
import { createDeadline } from "./api/deadline";

// Load environment variables from .env.local or .env
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = 3000;

// Origin + authentication guard for local development. The hourly cap and daily
// quota are NOT applied here: they live in Netlify Blobs and only run in the
// deployed functions (see api/guard.ts).
const authGuard = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Forbidden: Origin not allowed" },
    });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const isSupabaseConfigured = Boolean(
    supabaseUrl && supabaseKey && !supabaseUrl.includes("placeholder")
  );

  if (isSupabaseConfigured) {
    const authResult = await verifyAuth(req);
    if (authResult.success === false) {
      const { status, code, message } = authResult.error;
      return res.status(status).json({ success: false, error: { code, message } });
    }
    (req as any).user = authResult.user;
  }
  next();
};

// 1. Scene description generation
app.post("/api/generate-description", authGuard, async (req, res) => {
  const result = await handleGenerateDescription(req.body || {}, { deadline: createDeadline() });
  res.status(result.status).json(result.body);
});

// 2. Image generation
app.post("/api/generate-image", authGuard, async (req, res) => {
  const result = await handleGenerateImage(req.body || {}, { deadline: createDeadline() });
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
    // Express 5 no longer accepts a bare "*" path, so the SPA fallback is plain middleware.
    app.use((_req, res) => {
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
