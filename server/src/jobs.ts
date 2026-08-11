import { mkdirSync, rmSync } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { createJobLogger, formatBytes, type JobLogger } from "./job-logger.js";
import type { JobEvent, JobFailureKind, JobLogLine, JobRecord, JobStage } from "./models.js";
import { downloadDouyinVideo } from "./pipeline/douyin.js";
import { extractAudio, splitAudioIfNeeded } from "./pipeline/audio.js";
import { transcribeAudioFiles } from "./pipeline/mimo-asr.js";
import { normalizeShareText } from "./pipeline/url.js";
import { probeMediaDurationSec } from "./media-probe.js";

const jobs = new Map<string, JobRecord>();
const listeners = new Map<string, Set<(event: JobEvent) => void>>();
const eventLog = new Map<string, JobEvent[]>();

function nowIso(): string {
  return new Date().toISOString();
}

function emit(jobId: string, event: JobEvent): void {
  const job = jobs.get(jobId);
  if (job) {
    job.stage = event.stage;
    job.progress = event.progress;
    job.message = event.message;
    job.updated_at = nowIso();
    if (event.text !== undefined) job.text = event.text;
    if (event.error !== undefined) job.error = event.error;
    if (event.failure_kind !== undefined) job.failure_kind = event.failure_kind;
    if (event.log) job.logs.push(event.log);
  }
  if (!eventLog.has(jobId)) eventLog.set(jobId, []);
  eventLog.get(jobId)!.push(event);
  for (const fn of listeners.get(jobId) ?? []) fn(event);
}

export function getJobEvents(jobId: string): JobEvent[] {
  return eventLog.get(jobId) ?? [];
}

export function subscribeJob(jobId: string, fn: (event: JobEvent) => void): () => void {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(fn);
  return () => listeners.get(jobId)?.delete(fn);
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

export function exportJobSnapshot(jobId: string): JobRecord | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  return { ...job, logs: [...job.logs] };
}

export function createJob(shareText: string): JobRecord {
  const id = uuidv4();
  const record: JobRecord = {
    id,
    url: shareText,
    stage: "queued",
    progress: 0,
    message: "排队中",
    text: null,
    error: null,
    failure_kind: null,
    logs: [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  jobs.set(id, record);
  emit(id, {
    stage: "queued",
    progress: 0,
    message: "排队中",
    log: {
      id: uuidv4(),
      ts: nowIso(),
      level: "info",
      stage: "queued",
      message: "任务已创建，等待执行",
    },
  });
  setImmediate(() => void runJob(id, shareText));
  return record;
}

function makeLogger(jobId: string, getProgress: () => number): JobLogger {
  return createJobLogger(
    jobs.get(jobId)?.stage ?? "queued",
    (line, meta) => {
      emit(jobId, { ...meta, log: line });
    },
    getProgress,
  );
}

async function runJob(jobId: string, shareText: string): Promise<void> {
  const jobDir = join(config.tempDir, jobId);
  mkdirSync(jobDir, { recursive: true });

  let progress = 0;
  const log = makeLogger(jobId, () => progress);

  const step = (stage: JobStage, p: number, message: string, detail?: string) => {
    progress = p;
    log.step(stage, p, message, detail);
  };

  try {
    log.info("创建工作目录", jobDir);
    step("parsing", 5, "开始解析分享链接");
    log.debug("原始输入", shareText.slice(0, 200));
    const url = normalizeShareText(shareText);
    log.info("已提取抖音 URL", url);

    step("downloading", 15, "开始下载视频");
    log.info("准备下载", `目标目录 ${jobDir}`);
    const videoPath = await downloadDouyinVideo(shareText, jobDir, log);
    const videoSize = statSync(videoPath).size;
    const videoDur = await probeMediaDurationSec(videoPath, log, "video");
    log.info("视频下载完成", `${videoPath} (${formatBytes(videoSize)} · ${videoDur.toFixed(0)}s)`);

    step("extracting", 50, "开始提取音频");
    log.info("调用 ffmpeg", "mp3 · 16kHz · mono · 64kbps");
    const audioPath = await extractAudio(videoPath, jobDir, log);
    const audioSize = statSync(audioPath).size;
    log.info("音频提取完成", `${audioPath} (${formatBytes(audioSize)})`);

    log.info("检查是否需要分片", `单段 ≤${config.asrChunkSec}s · 偏短自动拆半重试 · 文件上限 ${formatBytes(9 * 1024 * 1024)}`);
    const chunks = await splitAudioIfNeeded(audioPath, jobDir, log);
    if (chunks.length > 1) {
      log.warn(`音频已切分为 ${chunks.length} 段`, chunks.map((c, i) => `#${i + 1} ${formatBytes(statSync(c).size)}`).join(", "));
    } else {
      log.info("无需分片", "单段发送 ASR");
    }

    step("transcribing", 70, `开始 MiMo ASR（${chunks.length} 段）`);
    log.info("ASR 配置", `${config.mimoBaseUrl} · ${config.mimoAsrModel} · lang=${config.asrLanguage}`);
    const text = await transcribeAudioFiles(chunks, log);

    emit(jobId, {
      stage: "done",
      progress: 100,
      message: "完成",
      text,
      log: {
        id: uuidv4(),
        ts: nowIso(),
        level: "info",
        stage: "done",
        message: "转写完成",
        detail: `共 ${text.length} 字`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let failure_kind: JobFailureKind = "download_failed";
    if ((err as Error & { kind?: string }).kind === "auth_required") failure_kind = "auth_required";
    else if (/MIMO|ASR|api-key/i.test(message)) failure_kind = "asr_failed";
    else if (/链接|URL/i.test(message)) failure_kind = "invalid_url";

    log.error("任务失败", message);
    emit(jobId, {
      stage: "failed",
      progress: 100,
      message: "失败",
      error: message,
      failure_kind,
      log: {
        id: uuidv4(),
        ts: nowIso(),
        level: "error",
        stage: "failed",
        message: "流水线终止",
        detail: message,
      },
    });
  } finally {
    try {
      rmSync(jobDir, { recursive: true, force: true });
    } catch {
      /* temp dir may already be gone */
    }
    const job = jobs.get(jobId);
    if (job && (job.stage === "done" || job.stage === "failed")) {
      emit(jobId, {
        stage: job.stage,
        progress: 100,
        message: job.message,
        text: job.text ?? undefined,
        error: job.error ?? undefined,
        failure_kind: job.failure_kind ?? undefined,
        log: {
          id: uuidv4(),
          ts: nowIso(),
          level: job.stage === "done" ? "info" : "error",
          stage: job.stage,
          message: job.stage === "done" ? "任务完成" : "任务失败",
          detail: job.stage === "done" ? `共 ${job.text?.length ?? 0} 字` : (job.error ?? undefined),
        },
      });
    }
  }
}
