import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { honoApiPlugin } from "./plugins/hono-api.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const webPort = Number(env.WEB_PORT ?? process.env.WEB_PORT ?? "3900");

  return {
    plugins: [honoApiPlugin()],
    server: {
      port: webPort,
      strictPort: true,
      host: "127.0.0.1",
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    ssr: {
      noExternal: ["hono", "@hono/node-server"],
    },
  };
});
