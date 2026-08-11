import { randomUUID } from "node:crypto";
import type { JobLogLevel, JobLogLine, JobStage } from "./models.js";

export interface JobLogger {
  step(stage: JobStage, progress: number, message: string, detail?: string): void;
  info(message: string, detail?: string): void;
  warn(message: string, detail?: string): void;
  error(message: string, detail?: string): void;
  debug(message: string, detail?: string): void;
}

export function createJobLogger(
  initialStage: JobStage,
  onLine: (line: JobLogLine, event: { stage: JobStage; progress: number; message: string }) => void,
  getProgress: () => number,
): JobLogger {
  let stage = initialStage;

  const write = (level: JobLogLevel, message: string, detail?: string) => {
    const line: JobLogLine = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      level,
      stage,
      message,
      detail,
    };
    onLine(line, { stage, progress: getProgress(), message });
  };

  return {
    step(nextStage, progress, message, detail) {
      stage = nextStage;
      const line: JobLogLine = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        level: "info",
        stage,
        message,
        detail,
      };
      onLine(line, { stage, progress, message });
    },
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
    debug: (m, d) => write("debug", m, d),
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
