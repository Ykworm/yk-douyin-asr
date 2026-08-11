import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createJob, exportJobSnapshot, getJob, getJobEvents, subscribeJob } from "../jobs.js";
import type { JobRecord } from "../models.js";

export const jobRoutes = new Hono();

function jobSnapshot(id: string): JobRecord | null {
  return exportJobSnapshot(id) ?? null;
}

jobRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as { url?: string };
  if (!body.url?.trim()) return c.json({ error: "url 必填" }, 400);
  const job = createJob(body.url.trim());
  return c.json(jobSnapshot(job.id) ?? job);
});

jobRoutes.get("/:id", (c) => {
  const job = jobSnapshot(c.req.param("id"));
  if (!job) return c.json({ error: "任务不存在" }, 404);
  return c.json(job);
});

jobRoutes.get("/:id/events", (c) => {
  const id = c.req.param("id");
  const job = getJob(id);
  if (!job) return c.json({ error: "任务不存在" }, 404);

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const sendUpdate = async () => {
      const snap = jobSnapshot(id);
      if (snap) await stream.writeSSE({ event: "update", data: JSON.stringify(snap) });
    };

    // Replay: one log event per line so UI always catches up.
    for (const event of getJobEvents(id)) {
      if (event.log) {
        await stream.writeSSE({ event: "log", data: JSON.stringify(event.log) });
      }
    }
    await sendUpdate();

    const latest = getJob(id);
    if (latest?.stage === "done" || latest?.stage === "failed") {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = async () => {
        if (settled) return;
        settled = true;
        await sendUpdate();
        resolve();
      };

      const unsub = subscribeJob(id, (event) => {
        void (async () => {
          try {
            if (event.log) {
              await stream.writeSSE({ event: "log", data: JSON.stringify(event.log) });
            }
            await sendUpdate();
            if (event.stage === "done" || event.stage === "failed") {
              unsub();
              await finish();
            }
          } catch {
            unsub();
            await finish();
          }
        })();
      });
    });
  });
});
