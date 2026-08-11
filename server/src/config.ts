import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

for (const envPath of [
  join(process.cwd(), ".env"),
  join(process.cwd(), "..", ".env"),
  join(process.cwd(), "..", "..", ".env"),
]) {
  if (existsSync(envPath)) loadEnv({ path: envPath });
}
loadEnv();

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}


export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? "3900"),
  mimoApiKey: process.env.MIMO_API_KEY ?? "",
  mimoBaseUrl: process.env.MIMO_BASE_URL ?? "https://token-plan-cn.xiaomimimo.com/v1",
  mimoAsrModel: process.env.MIMO_ASR_MODEL ?? "mimo-v2.5-asr",
  mimoTtsModel: process.env.MIMO_TTS_MODEL ?? "mimo-v2.5-tts",
  mimoTtsVoice: process.env.MIMO_TTS_VOICE ?? "冰糖",
  /** user 消息：音色/风格 + 必须逐字朗读 */
  mimoTtsStylePrompt:
    process.env.MIMO_TTS_STYLE_PROMPT ??
    "成熟御姐女声，中低音，磁性慵懒，语速自然。请严格逐字朗读 assistant 消息中的正文，不要改写、不要省略、不要添加、不要总结。",
  /** 仅 mimo-v2.5-tts-voicedesign 时使用 */
  mimoTtsVoicePrompt:
    process.env.MIMO_TTS_VOICE_PROMPT ??
    "成熟御姐女声，25-30岁，中低音区，声线丝滑醇厚带着磁性。语速从容不迫，语气慵懒自信。",
  asrLanguage: (process.env.ASR_LANGUAGE ?? "zh") as "auto" | "zh" | "en",
  /** 单段 ASR 音频上限（秒）。口播密集时建议 60–90 */
  asrChunkSec: Number(process.env.ASR_CHUNK_SEC ?? "90"),
  /** 低于此字/秒视为识别偏短，自动拆半重试 */
  asrMinCharsPerSec: Number(process.env.ASR_MIN_CHARS_PER_SEC ?? "2.5"),
  tempDir: expandHome(process.env.TEMP_DIR ?? "/tmp/yk-douyin-asr"),
  dataDir: expandHome(process.env.DATA_DIR ?? "~/.yk-douyin-asr"),
  douyinAuthSource: process.env.DOUYIN_AUTH_SOURCE ?? "auto",
  douyinChromeProfile: process.env.DOUYIN_CHROME_PROFILE ?? "Default",
  douyinLoginTimeoutSec: Number(process.env.DOUYIN_LOGIN_TIMEOUT_SEC ?? "120"),
  douyinLoginHeadfulFallback: process.env.DOUYIN_LOGIN_HEADFUL_FALLBACK !== "false",
};

export function cookiesFilePath(): string {
  return join(config.dataDir, "cookies.txt");
}

export function chromiumProfilePath(): string {
  return join(config.dataDir, "chromium-profile");
}

export function authStatePath(): string {
  return join(config.dataDir, "auth.json");
}
