import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp, resolveWebDist } from "./app.js";
import { config } from "./config.js";

const app = createApp();
const webDist = resolveWebDist();

if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: join(webDist, "index.html") }));
}

const url = `http://${config.host}:${config.port}`;
console.log("");
console.log(`  yk-douyin-asr  →  ${url}`);
console.log("");

serve({ fetch: app.fetch, hostname: config.host, port: config.port });
