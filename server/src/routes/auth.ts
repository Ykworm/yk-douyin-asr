import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getAuthStatus, applyAuthSource } from "../auth/sources.js";
import { listBrowserProfiles } from "../auth/chrome.js";
import { getLoginSession, startPlaywrightLogin, logoutPlaywright } from "../auth/douyin.js";
import type { SetAuthSourceBody } from "../models.js";

export const authRoutes = new Hono();

authRoutes.get("/status", async (c) => {
  return c.json(await getAuthStatus());
});

authRoutes.get("/browsers", async (c) => {
  return c.json({ browsers: await listBrowserProfiles() });
});

authRoutes.put("/source", async (c) => {
  const body = (await c.req.json()) as SetAuthSourceBody;
  const status = await applyAuthSource(body.source, body.cookies_file);
  return c.json(status);
});

authRoutes.post("/login/start", async (c) => {
  await applyAuthSource("playwright");
  const session = await startPlaywrightLogin();
  return c.json({ session_id: session.id, status: session.status, message: session.message });
});

authRoutes.get("/login/:id/events", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let lastQr: string | null = null;
    const deadline = Date.now() + 130_000;
    while (Date.now() < deadline) {
      const session = getLoginSession(id);
      if (!session) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "会话不存在" }) });
        break;
      }
      const payload = {
        status: session.status,
        message: session.message,
        qr_base64: session.qr_base64,
      };
      if (session.qr_base64 !== lastQr) {
        lastQr = session.qr_base64;
        await stream.writeSSE({ event: "update", data: JSON.stringify(payload) });
      } else {
        await stream.writeSSE({ event: "heartbeat", data: JSON.stringify(payload) });
      }
      if (session.status === "success" || session.status === "timeout" || session.status === "failed") {
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await stream.close();
  });
});

authRoutes.post("/logout", async (c) => {
  await logoutPlaywright();
  const status = await getAuthStatus();
  return c.json({ ok: true, status });
});
