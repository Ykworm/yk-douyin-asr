import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserProfileInfo } from "../models.js";
import { chromeBrowserArg, getAuthState } from "./state.js";

const CHROME_BASE = join(homedir(), "Library/Application Support/Google/Chrome");

type ProbeResult = { readable: boolean; hasDouyin: boolean; error: string | null };

let probeCache: { at: number; data: BrowserProfileInfo[] } | null = null;
const PROBE_CACHE_MS = 60_000;

export async function runCommand(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: opts?.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(124);
      stderr += stderr ? "\n" : "" + "命令超时";
    }, opts?.timeoutMs ?? 120_000);

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => finish(code ?? 1));
    proc.on("error", (err) => {
      const msg = err.message.includes("ENOENT") ? `${cmd} 未安装` : String(err);
      stderr += msg;
      finish(1);
    });
  });
}

export function listChromeProfiles(): string[] {
  const localStatePath = join(CHROME_BASE, "Local State");
  if (!existsSync(localStatePath)) return ["Default"];
  try {
    const data = JSON.parse(readFileSync(localStatePath, "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const keys = Object.keys(data.profile?.info_cache ?? {});
    return keys.length > 0 ? keys : ["Default"];
  } catch {
    return ["Default"];
  }
}

/** Export Chrome cookies via yt-dlp, then check for douyin.com entries. */
async function probeDouyinCookie(browserArg: string): Promise<ProbeResult> {
  const cookieFile = join(tmpdir(), `yk-douyin-asr-probe-${randomUUID()}.txt`);

  try {
    const result = await new Promise<ProbeResult>((resolve) => {
      const proc = spawn(
        "yt-dlp",
        [
          "--cookies-from-browser",
          browserArg,
          "--cookies",
          cookieFile,
          "--skip-download",
          "--simulate",
          "--no-warnings",
          "--socket-timeout",
          "5",
          "https://www.google.com/robots.txt",
        ],
        { env: process.env },
      );

      let stderr = "";
      let settled = false;

      const finish = (value: ProbeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve(value);
      };

      const checkCookies = () => {
        if (!existsSync(cookieFile)) return false;
        const text = readFileSync(cookieFile, "utf8");
        const hasDouyin = /\tdouyin\.com/i.test(text) || /\t\.douyin\.com/i.test(text);
        finish({ readable: true, hasDouyin, error: hasDouyin ? null : "Chrome 中未找到 douyin.com Cookie，请先在 Chrome 登录抖音" });
        return true;
      };

      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (/Extracted \d+ cookies/i.test(stderr)) {
          setTimeout(() => {
            if (checkCookies()) return;
            finish({ readable: true, hasDouyin: false, error: "已读取 Chrome，但未发现抖音登录 Cookie" });
          }, 300);
        }
      });

      proc.on("error", (err) => {
        const msg = err.message.includes("ENOENT") ? "yt-dlp 未安装（brew install yt-dlp）" : err.message;
        finish({ readable: false, hasDouyin: false, error: msg });
      });

      proc.on("close", (code) => {
        if (settled) return;
        if (checkCookies()) return;
        if (/Operation not permitted|Permission denied|Could not copy/i.test(stderr)) {
          finish({ readable: false, hasDouyin: false, error: "可能需要 macOS「完全磁盘访问权限」（授权 Terminal/Cursor）" });
          return;
        }
        finish({
          readable: false,
          hasDouyin: false,
          error: stderr.trim() || (code === 124 ? "读取 Cookie 超时" : "无法读取 Chrome Cookie"),
        });
      });

      const hardTimer = setTimeout(() => {
        if (checkCookies()) return;
        finish({ readable: false, hasDouyin: false, error: "读取 Chrome Cookie 超时" });
      }, 12_000);
    });

    return result;
  } finally {
    rmSync(cookieFile, { force: true });
  }
}

export async function listBrowserProfiles(): Promise<BrowserProfileInfo[]> {
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.data;
  }

  const profiles = listChromeProfiles();
  const results: BrowserProfileInfo[] = [];
  for (const id of profiles) {
    const browserArg = id === "Default" ? "chrome" : `chrome:${id}`;
    const probe = await probeDouyinCookie(browserArg);
    results.push({
      id: browserArg,
      label: id,
      has_douyin_cookie: probe.hasDouyin && probe.readable,
      readable: probe.readable,
      error: probe.error,
    });
  }

  probeCache = { at: Date.now(), data: results };
  return results;
}

export async function resolveChromeAuth(): Promise<{ browserArg: string; loggedIn: boolean; warning: string | null }> {
  const profiles = await listBrowserProfiles();
  const preferred = chromeBrowserArg(getAuthState().chromeProfile);
  const preferredEntry = profiles.find((p) => p.id === preferred);
  if (preferredEntry?.has_douyin_cookie) {
    return { browserArg: preferred, loggedIn: true, warning: null };
  }
  const any = profiles.find((p) => p.has_douyin_cookie);
  if (any) {
    return {
      browserArg: any.id,
      loggedIn: true,
      warning: `已自动使用 Chrome Profile「${any.label}」`,
    };
  }
  const readError = profiles.find((p) => p.error)?.error;
  return {
    browserArg: preferred,
    loggedIn: false,
    warning: readError ?? "未检测到 Chrome 抖音登录态",
  };
}

export function cookiesFromBrowserArgs(browserArg: string): string[] {
  return ["--cookies-from-browser", browserArg];
}

export function invalidateProbeCache(): void {
  probeCache = null;
}
