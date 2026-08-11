import { Hono } from "hono";
import { synthesizeYujieSpeech, normalizeTextForTts } from "../pipeline/mimo-tts.js";

export const ttsRoutes = new Hono();

ttsRoutes.get("/", (c) =>
  c.json({
    ok: true,
    voice: "yujie",
    model: process.env.MIMO_TTS_MODEL ?? "mimo-v2.5-tts",
    preset: process.env.MIMO_TTS_VOICE ?? "冰糖",
    mode: "verbatim",
  }),
);

ttsRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as { text?: string; verbatim?: boolean };
  if (!body.text?.trim()) return c.json({ error: "text 必填" }, 400);

  try {
    const text = normalizeTextForTts(body.text);
    const result = await synthesizeYujieSpeech(text);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});
