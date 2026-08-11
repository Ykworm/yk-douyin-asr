import { apiPath } from "./api.js";

export type JobLogLevel = "info" | "warn" | "error" | "debug";

export interface JobLogLine {
  id: string;
  ts: string;
  level: JobLogLevel;
  stage: string;
  message: string;
  detail?: string;
}

export interface JobRecord {
  id: string;
  stage: string;
  progress: number;
  message: string;
  text: string | null;
  error: string | null;
  failure_kind: string | null;
  logs?: JobLogLine[];
}

export async function createJob(url: string): Promise<JobRecord> {
  const res = await fetch(apiPath("/jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchJob(jobId: string): Promise<JobRecord | null> {
  const res = await fetch(apiPath(`/jobs/${jobId}`));
  if (!res.ok) return null;
  return res.json();
}

export function subscribeJob(
  jobId: string,
  handlers: {
    onUpdate: (job: JobRecord) => void;
    onLog?: (line: JobLogLine) => void;
  },
): () => void {
  const es = new EventSource(apiPath(`/jobs/${jobId}/events`));

  es.addEventListener("update", (ev) => {
    try {
      handlers.onUpdate(JSON.parse(ev.data));
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener("log", (ev) => {
    try {
      handlers.onLog?.(JSON.parse(ev.data));
    } catch {
      /* ignore malformed */
    }
  });

  es.onerror = () => {
    // Polling fallback keeps logs in sync if SSE drops.
  };

  return () => es.close();
}

export function pollJob(
  jobId: string,
  handlers: {
    onUpdate: (job: JobRecord) => void;
    onLogs?: (logs: JobLogLine[]) => void;
  },
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const job = await fetchJob(jobId);
    if (job) {
      handlers.onUpdate(job);
      if (job.logs?.length) handlers.onLogs?.(job.logs);
    }
    if (job && (job.stage === "done" || job.stage === "failed")) {
      stopped = true;
      return;
    }
    setTimeout(tick, 350);
  };
  void tick();
  return () => {
    stopped = true;
  };
}

export function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    queued: "排队",
    parsing: "解析",
    downloading: "下载",
    extracting: "抽音频",
    transcribing: "识别",
    done: "完成",
    failed: "失败",
  };
  return map[stage] ?? stage;
}

const STAGE_ORDER = ["queued", "parsing", "downloading", "extracting", "transcribing"] as const;

export function renderProgress(container: HTMLElement, stage: string): void {
  const currentIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const activeIdx = currentIdx >= 0 ? currentIdx : 0;

  container.innerHTML = STAGE_ORDER.map((s, idx) => {
    let cls = "step";
    if (stage === "failed" && s === STAGE_ORDER[activeIdx]) cls += " active";
    else if (stage === "done" || idx < activeIdx) cls += " done";
    else if (idx === activeIdx) cls += " active";
    return `<div class="${cls}">${stageLabel(s)}</div>`;
  }).join("");
}

export function applyJobUpdate(
  job: JobRecord,
  handlers: {
    onProgress: (job: JobRecord) => void;
    onDone: (text: string) => void;
    onFailed: (job: JobRecord) => void;
    onLogs?: (logs: JobLogLine[]) => void;
    onLog?: (line: JobLogLine) => void;
  },
): boolean {
  handlers.onProgress(job);
  if (job.logs?.length) handlers.onLogs?.(job.logs);
  if (job.stage === "done") {
    handlers.onDone(job.text ?? "");
    return true;
  }
  if (job.stage === "failed") {
    handlers.onFailed(job);
    return true;
  }
  return false;
}
