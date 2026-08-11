import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { config } from "../config.js";
import { runCommand } from "../auth/chrome.js";

/** 单段不宜过长，否则模型容易「概括」而不是念稿 */
const MAX_CHARS_PER_CHUNK = 600;

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

function isVoiceDesignModel(): boolean {
  return config.mimoTtsModel.includes("voicedesign");
}

/** 按句号/换行切分，避免从句子中间硬截断 */
function splitText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= MAX_CHARS_PER_CHUNK) return [normalized];

  const parts = normalized.split(/(?<=[。！？!?；;\n])/);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if (piece.length > MAX_CHARS_PER_CHUNK) {
      flush();
      for (let i = 0; i < piece.length; i += MAX_CHARS_PER_CHUNK) {
        chunks.push(piece.slice(i, i + MAX_CHARS_PER_CHUNK));
      }
      continue;
    }
    if ((buf + piece).trim().length > MAX_CHARS_PER_CHUNK) flush();
    buf += part;
  }
  flush();
  return chunks.length ? chunks : [normalized];
}

type AudioMessage = OpenAI.Chat.ChatCompletionMessage & {
  audio?: { data?: string };
  content?: string | null;
};

function buildMessages(text: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (isVoiceDesignModel()) {
    return [
      {
        role: "user",
        content: `${config.mimoTtsVoicePrompt}\n请逐字朗读 assistant 中的正文，不要改写。`,
      },
      { role: "assistant", content: text },
    ];
  }
  return [
    { role: "user", content: config.mimoTtsStylePrompt },
    { role: "assistant", content: text },
  ];
}

function buildAudioExtra(): Record<string, unknown> {
  if (isVoiceDesignModel()) {
    return { audio: { format: "wav" } };
  }
  return { audio: { format: "wav", voice: config.mimoTtsVoice } };
}

async function synthesizeChunk(text: string, index: number, total: number): Promise<Buffer> {
  const completion = await getClient().chat.completions.create({
    model: config.mimoTtsModel,
    messages: buildMessages(text),
    ...buildAudioExtra(),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

  const message = completion.choices[0]?.message as AudioMessage | undefined;
  const data = message?.audio?.data;
  if (!data) {
    const hint = message?.content?.trim();
    throw new Error(hint ? `TTS 未返回音频: ${hint.slice(0, 120)}` : `TTS 第 ${index}/${total} 段未返回音频`);
  }
  return Buffer.from(data, "base64");
}

async function concatWavFiles(paths: string[], outPath: string): Promise<void> {
  if (paths.length === 1) {
    writeFileSync(outPath, readFileSync(paths[0]));
    return;
  }
  const listPath = join(outPath, "..", "concat.txt");
  writeFileSync(listPath, paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const { code, stderr } = await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outPath,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || "ffmpeg 合并音频失败");
}

export async function synthesizeYujieSpeech(text: string): Promise<{ format: "wav"; audio_base64: string; chunks: number }> {
  const chunks = splitText(text);
  if (!chunks.length) throw new Error("文本为空");

  const workDir = join(config.tempDir, `tts-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    const wavPaths: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const wav = await synthesizeChunk(chunks[i], i + 1, chunks.length);
      const path = join(workDir, `part-${String(i).padStart(3, "0")}.wav`);
      writeFileSync(path, wav);
      wavPaths.push(path);
    }

    const outPath = join(workDir, "speech.wav");
    await concatWavFiles(wavPaths, outPath);
    const audio = readFileSync(outPath);
    return {
      format: "wav",
      audio_base64: audio.toString("base64"),
      chunks: chunks.length,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function normalizeTextForTts(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
