import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config.js";
import { runLoggedCommand } from "../command-log.js";
import type { JobLogger } from "../job-logger.js";
import { formatBytes } from "../job-logger.js";
import { formatDuration, probeMediaDurationSec } from "../media-probe.js";

/** MiMo ASR 单次输出约 2k tokens，长段易截断 → 按时长切分 */
const MAX_CHUNK_BYTES = 9 * 1024 * 1024;

export async function extractAudio(videoPath: string, outDir: string, log?: JobLogger): Promise<string> {
  const audioPath = join(outDir, "audio.mp3");
  const args = ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "64k", audioPath];
  log?.info("ffmpeg 抽音频", basename(videoPath));
  const { code, stderr } = await runLoggedCommand(log, "ffmpeg", "ffmpeg", args);
  if (code !== 0 || !existsSync(audioPath)) {
    log?.error("ffmpeg 失败", stderr.trim().slice(0, 400));
    throw new Error(stderr.trim() || "ffmpeg 抽音频失败，请确认已安装 ffmpeg");
  }
  const dur = await probeMediaDurationSec(audioPath, log, "audio");
  log?.info("ffmpeg 完成", `${basename(audioPath)} ${formatBytes(statSync(audioPath).size)} · ${formatDuration(dur)}`);
  return audioPath;
}

function chunkDurationSec(totalSec: number, totalBytes: number): number {
  let chunkSec = config.asrChunkSec;
  if (totalBytes > MAX_CHUNK_BYTES && totalSec > 0) {
    const bytesPerSec = totalBytes / totalSec;
    const sizeBased = Math.floor(MAX_CHUNK_BYTES / bytesPerSec);
    chunkSec = Math.min(chunkSec, sizeBased);
  }
  return Math.max(30, chunkSec);
}

export async function splitAudioIfNeeded(audioPath: string, outDir: string, log?: JobLogger): Promise<string[]> {
  const size = statSync(audioPath).size;
  const duration = await probeMediaDurationSec(audioPath, log, "audio");
  const chunkSec = chunkDurationSec(duration, size);
  const expectedChunks = duration > 0 ? Math.ceil(duration / chunkSec) : 1;

  if (size <= MAX_CHUNK_BYTES && duration <= config.asrChunkSec) {
    log?.info("音频无需分片", `${formatDuration(duration)} · ${formatBytes(size)}`);
    return [audioPath];
  }

  log?.info(
    "ASR 分片策略",
    `总时长 ${formatDuration(duration)} · 每段 ≤${chunkSec}s · 预计 ${expectedChunks} 段`,
  );

  const pattern = join(outDir, "chunk_%03d.mp3");
  const { code, stderr } = await runLoggedCommand(log, "ffmpeg-split", "ffmpeg", [
    "-y",
    "-i",
    audioPath,
    "-f",
    "segment",
    "-segment_time",
    String(chunkSec),
    "-reset_timestamps",
    "1",
    "-acodec",
    "libmp3lame",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-b:a",
    "64k",
    pattern,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || "音频分片失败");

  const chunks = readdirSync(outDir)
    .filter((f) => /^chunk_\d+\.mp3$/.test(f))
    .sort()
    .map((f) => join(outDir, f));

  for (let i = 0; i < chunks.length; i++) {
    const sec = await probeMediaDurationSec(chunks[i], log, `chunk#${i + 1}`);
    log?.info(`分片 #${i + 1}`, `${formatDuration(sec)} · ${formatBytes(statSync(chunks[i]).size)}`);
  }

  log?.info("分片完成", `共 ${chunks.length} 个文件`);
  return chunks;
}

/** 将一段音频从中点拆成两半（用于 ASR 偏短重试） */
export async function splitAudioHalf(audioPath: string, outDir: string, log?: JobLogger): Promise<[string, string]> {
  const duration = await probeMediaDurationSec(audioPath, log, "split-half");
  const mid = Math.max(15, duration / 2);
  const a = join(outDir, "half_a.mp3");
  const b = join(outDir, "half_b.mp3");
  const enc = ["-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "64k"];

  let { code, stderr } = await runLoggedCommand(log, "ffmpeg-half-a", "ffmpeg", [
    "-y", "-i", audioPath, "-t", String(mid), ...enc, a,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || "音频拆半失败");

  ({ code, stderr } = await runLoggedCommand(log, "ffmpeg-half-b", "ffmpeg", [
    "-y", "-i", audioPath, "-ss", String(mid), ...enc, b,
  ]));
  if (code !== 0) throw new Error(stderr.trim() || "音频拆半失败");

  return [a, b];
}

export { MAX_CHUNK_BYTES };
