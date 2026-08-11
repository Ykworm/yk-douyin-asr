import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth.js";
import { jobRoutes } from "./routes/jobs.js";
import { healthRoutes } from "./routes/health.js";
import { ttsRoutes } from "./routes/tts.js";

export function createApp(): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "OPTIONS"] }));
  app.route("/api/health", healthRoutes);
  app.route("/api/auth/douyin", authRoutes);
  app.route("/api/jobs", jobRoutes);
  app.route("/api/tts", ttsRoutes);
  return app;
}

export function resolveWebDist(): string {
  const candidates = [
    join(process.cwd(), "dist"),
    join(process.cwd(), "..", "web", "dist"),
    join(process.cwd(), "web", "dist"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
