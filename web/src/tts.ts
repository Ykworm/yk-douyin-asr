import { apiPath } from "./api.js";

export interface TtsResult {
  format: "wav";
  audio_base64: string;
  chunks: number;
}

export async function synthesizeYujie(text: string): Promise<TtsResult> {
  const res = await fetch(apiPath("/tts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    let message = "TTS 失败";
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      message = await res.text();
    }
    throw new Error(message);
  }
  return res.json();
}

export function wavBlobFromBase64(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}
