import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { getRequestListener } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type NodeListener = (req: IncomingMessage, res: ServerResponse) => void;

function appEntry(server: ViteDevServer): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../server/src/app.ts");
}

async function loadApiListener(server: ViteDevServer): Promise<NodeListener> {
  const mod = (await server.ssrLoadModule(appEntry(server))) as {
    createApp: () => { fetch: typeof fetch };
  };
  return getRequestListener(mod.createApp().fetch);
}

export function honoApiPlugin(): Plugin {
  let apiListener: NodeListener | null = null;

  return {
    name: "yk-douyin-asr-hono-api",
    configureServer(server) {
      // Pick up new server routes (e.g. /api/tts) without restarting Vite.
      server.watcher.on("change", (file) => {
        if (file.includes("/server/src/")) apiListener = null;
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        try {
          if (!apiListener) apiListener = await loadApiListener(server);
          return apiListener(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}
