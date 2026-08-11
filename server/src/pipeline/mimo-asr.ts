import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OpenAI from "openai";
import { config } from "../config.js";
import type { JobLogger } from "../job-logger.js";
import { formatBytes } from "../job-logger.js";
import { formatDuration, probeMediaDurationSec } from "../media-probe.js";
import { splitAudioHalf } from "./audio.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.mimoApiKey) throw new Error("未配置 MIMO_API_KEY");
    client = new OpenAI({
      apiKey: config.mimoApiKey,
      baseURL: config.mimoBaseUrl,
    });
  }
  return client;
}

type AudioMessage = OpenAI.Chat.ChatCompletionMessage & {
  audio?: { data?: string };
};

async function callAsrOnce(audioPath: string, log?: JobLogger): Promise<{ text: string; finishReason: string | null }> {
  const bytes = readFileSync(audioPath);
  const base64 = bytes.toString("base64");
  log?.debug("Base64 编码完成", formatBytes(base64.length));

  const completion = await getClient().chat.completions.create({
    model: config.mimoAsrModel,
    max_completion_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: `data:audio/mpeg;base64,${base64}`,
            },
          },
        ],
      },
    ],
    ...({ asr_options: { language: config.asrLanguage } } as Record<string, unknown>),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

  const message = completion.choices[0]?.message as AudioMessage | undefined;
  const text = message?.content?.trim() ?? "";
  const finishReason = completion.choices[0]?.finish_reason ?? null;
  return { text, finishReason };
}

async function transcribeFileOnce(
  audioPath: string,
  label: string,
  log?: JobLogger,
): Promise<{ text: string; duration: number; finishReason: string | null }> {
  const size = statSync(audioPath).size;
  const duration = await probeMediaDurationSec(audioPath, log, label);
  log?.info(`ASR 请求 ${label}`, `${size ? formatBytes(size) : ""} · ${formatDuration(duration)}`.trim());

  const started = Date.now();
  const { text, finishReason } = await callAsrOnce(audioPath, log);
  if (!text) throw new Error(`ASR 返回空文本 (${label})`);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const cps = duration > 0 ? (text.length / duration).toFixed(1) : "?";
  if (finishReason === "length") {
    log?.warn(`ASR ${label} 可能被截断`, `finish_reason=length · ${text.length} 字`);
  }
  log?.info(`ASR ${label} 完成`, `${text.length} 字 · ${cps} 字/秒 · ${elapsed}s`);
  return { text, duration, finishReason };
}

function isUnderTranscribed(text: string, durationSec: number): boolean {
  if (durationSec < 20) return false;
  const cps = text.length / durationSec;
  return cps < config.asrMinCharsPerSec;
}

async function transcribeWithRetry(
  audioPath: string,
  index: number,
  total: number,
  log?: JobLogger,
  depth = 0,
): Promise<string> {
  const label = `${index}/${total}`;
  const { text, duration, finishReason } = await transcribeFileOnce(audioPath, label, log);

  const needsRetry =
    depth < 2 &&
    duration >= 30 &&
    (finishReason === "length" || isUnderTranscribed(text, duration));

  if (!needsRetry) return text;

  log?.warn(
    `ASR ${label} 识别偏短`,
    `${text.length} 字 / ${formatDuration(duration)}（阈值 ${config.asrMinCharsPerSec} 字/秒），拆半重试`,
  );

  const workDir = mkdtempSync(join(tmpdir(), "yk-asr-retry-"));
  try {
    const [a, b] = await splitAudioHalf(audioPath, workDir, log);
    const partA = await transcribeWithRetry(a, index, total, log, depth + 1);
    await sleep(400);
    const partB = await transcribeWithRetry(b, index, total, log, depth + 1);
    const merged = `${partA}\n\n${partB}`.trim();
    log?.info(`ASR ${label} 重试合并`, `${merged.length} 字（原 ${text.length} 字）`);
    return merged;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function transcribeAudioFiles(paths: string[], log?: JobLogger): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const part = await transcribeWithRetry(paths[i], i + 1, paths.length, log);
    parts.push(part);
    if (paths.length > 1 && i < paths.length - 1) {
      log?.debug("分片间隔", "500ms");
      await sleep(500);
    }
  }
  log?.info("ASR 全部完成", `合并 ${parts.length} 段 · 共 ${parts.join("").length} 字`);
  return parts.join("\n\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function verifyMimoAsr(): Promise<{ ok: boolean; message: string }> {
  if (!config.mimoApiKey) {
    return { ok: false, message: "MIMO_API_KEY 未配置" };
  }
  try {
    getClient();
    return { ok: true, message: `已配置 ${config.mimoBaseUrl} / ${config.mimoAsrModel}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
