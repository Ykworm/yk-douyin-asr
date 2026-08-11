import { Hono } from "hono";
import { runCommand } from "../auth/chrome.js";
import { getAuthStatus } from "../auth/sources.js";
import { verifyMimoAsr } from "../pipeline/mimo-asr.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  const [ffmpeg, ytdlp, mimo, auth] = await Promise.all([
    runCommand("ffmpeg", ["-version"]),
    runCommand("yt-dlp", ["--version"]),
    verifyMimoAsr(),
    getAuthStatus(),
  ]);

  return c.json({
    ok: ffmpeg.code === 0 && ytdlp.code === 0 && mimo.ok,
    ffmpeg: ffmpeg.code === 0,
    ytdlp: ytdlp.code === 0,
    mimo,
    auth,
  });
});
