import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import OpenAI from "openai";
import { config } from "../config.js";
import type { JobLogger } from "../job-logger.js";
import { formatBytes } from "../job-logger.js";

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

async function transcribeFile(audioPath: string, index: number, total: number, log?: JobLogger): Promise<string> {
  const size = statSync(audioPath).size;
  log?.info(`ASR 请求 ${index}/${total}`, `${basename(audioPath)} · ${formatBytes(size)}`);

  const bytes = readFileSync(audioPath);
  const base64 = bytes.toString("base64");
  log?.debug("Base64 编码完成", formatBytes(base64.length));

  const started = Date.now();
  const completion = await getClient().chat.completions.create({
    model: config.mimoAsrModel,
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

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("ASR 返回空文本");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const finishReason = completion.choices[0]?.finish_reason;
  if (finishReason === "length") {
    log?.warn(`ASR 段 ${index} 可能被截断`, `finish_reason=length · ${text.length} 字`);
  }
  log?.info(`ASR 段 ${index} 完成`, `${text.length} 字 · ${elapsed}s${finishReason ? ` · ${finishReason}` : ""}`);
  return text;
}

export async function transcribeAudioFiles(paths: string[], log?: JobLogger): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const part = await transcribeFile(paths[i], i + 1, paths.length, log);
    parts.push(part);
    if (paths.length > 1 && i < paths.length - 1) {
      log?.debug("分片间隔", "500ms");
      await sleep(500);
    }
  }
  log?.info("ASR 全部完成", `合并 ${parts.length} 段`);
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
