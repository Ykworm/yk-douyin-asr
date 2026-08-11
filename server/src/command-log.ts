import { spawn } from "node:child_process";
import type { JobLogger } from "./job-logger.js";

export async function runLoggedCommand(
  log: JobLogger | undefined,
  label: string,
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const safeArgs = args.map((a) => (a.includes("cookie") || a.length > 120 ? "…" : a));
  log?.debug(`${label} 命令`, `${cmd} ${safeArgs.join(" ")}`);

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: opts?.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const pushLines = (chunk: string, stream: "stdout" | "stderr") => {
      const text = stream === "stdout" ? stdout : stderr;
      const combined = text + chunk;
      if (stream === "stdout") stdout = combined;
      else stderr = combined;

      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        log?.debug(`${label} ${stream}`, trimmed);
      }
    };

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) log?.info(`${label} 完成`, `exit 0`);
      else log?.warn(`${label} 非零退出`, `exit ${code}`);
      resolve({ code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      log?.error(`${label} 超时`, `${opts?.timeoutMs ?? 120_000}ms`);
      finish(124);
    }, opts?.timeoutMs ?? 120_000);

    proc.stdout.on("data", (d: Buffer) => pushLines(d.toString(), "stdout"));
    proc.stderr.on("data", (d: Buffer) => pushLines(d.toString(), "stderr"));
    proc.on("error", (err) => {
      log?.error(`${label} 启动失败`, err.message);
      finish(127);
    });
    proc.on("close", (code) => finish(code ?? 1));
  });
}
