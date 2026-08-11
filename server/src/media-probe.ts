import { runCommand } from "./auth/chrome.js";
import { runLoggedCommand } from "./command-log.js";
import type { JobLogger } from "./job-logger.js";

export async function probeMediaDurationSec(path: string, log?: JobLogger, label = "ffprobe"): Promise<number> {
  const { code, stdout, stderr } = await runLoggedCommand(log, label, "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || "ffprobe 失败");
  const sec = Math.max(0, parseFloat(stdout.trim()) || 0);
  log?.debug(`${label} 时长`, `${sec.toFixed(1)} 秒`);
  return sec;
}

/** yt-dlp 仅探测时长，不下载 */
export async function probeYtDlpDuration(url: string, extraArgs: string[], log?: JobLogger): Promise<number | null> {
  const { code, stdout, stderr } = await runCommand("yt-dlp", [
    ...extraArgs,
    "--no-playlist",
    "--print",
    "duration",
    "--skip-download",
    url,
  ]);
  if (code !== 0) {
    log?.warn("yt-dlp 时长探测失败", stderr.trim().slice(0, 200));
    return null;
  }
  const sec = parseFloat(stdout.trim());
  return Number.isFinite(sec) ? sec : null;
}

export function formatDuration(sec: number): string {
  if (sec <= 0) return "未知";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
