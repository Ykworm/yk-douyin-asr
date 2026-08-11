import { mkdirSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { chromium } from "playwright";
import { config, cookiesFilePath, chromiumProfilePath } from "../config.js";
import { runCommand, cookiesFromBrowserArgs } from "../auth/chrome.js";
import { runLoggedCommand } from "../command-log.js";
import { formatDuration, probeMediaDurationSec, probeYtDlpDuration } from "../media-probe.js";
import { resolveDownloadAuth } from "../auth/sources.js";
import type { JobLogger } from "../job-logger.js";
import { formatBytes } from "../job-logger.js";
import { normalizeShareText } from "./url.js";

function findNewestVideo(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /\.(mp4|webm|mkv|m4a|mp3)$/i.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

async function downloadWithYtDlp(
  url: string,
  outDir: string,
  extraArgs: string[],
  log?: JobLogger,
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const metaDuration = await probeYtDlpDuration(url, extraArgs, log);
  if (metaDuration != null) {
    log?.info("yt-dlp 元数据时长", formatDuration(metaDuration));
  }

  const outTemplate = join(outDir, "video.%(ext)s");
  const args = [
    ...extraArgs,
    "-f",
    "bestvideo*+bestaudio/best",
    "--merge-output-format",
    "mp4",
    "--no-part",
    "-o",
    outTemplate,
    "--no-playlist",
    url,
  ];
  log?.info("yt-dlp 开始下载", url);
  const { code, stderr, stdout } = await runLoggedCommand(log, "yt-dlp", "yt-dlp", args, { cwd: outDir, timeoutMs: 300_000 });
  if (code !== 0) {
    log?.error("yt-dlp 失败", (stderr || stdout).trim().slice(0, 500));
    throw new Error(stderr.trim() || "yt-dlp 下载失败");
  }
  const file = findNewestVideo(outDir);
  if (!file) throw new Error("yt-dlp 未产生视频文件");

  const fileDuration = await probeMediaDurationSec(file, log, "video");
  log?.info("yt-dlp 成功", `${basename(file)} · ${formatBytes(statSync(file).size)} · ${formatDuration(fileDuration)}`);

  if (metaDuration != null && fileDuration > 0 && fileDuration < metaDuration * 0.85) {
    log?.warn(
      "下载时长偏短",
      `元数据 ${formatDuration(metaDuration)} vs 文件 ${formatDuration(fileDuration)}，可能未下完`,
    );
  }

  return file;
}

async function downloadWithPlaywright(url: string, outDir: string, browserArg?: string, log?: JobLogger): Promise<string> {
  log?.warn("yt-dlp 失败，切换 Playwright fallback");
  mkdirSync(outDir, { recursive: true });
  const profileDir = chromiumProfilePath();
  mkdirSync(profileDir, { recursive: true });

  log?.info("启动 Playwright Chromium", profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });

  try {
    if (browserArg) {
      log?.info("注入 Chrome Cookie", browserArg);
      const tmpCookie = join(outDir, "tmp-cookies.txt");
      await runCommand("yt-dlp", [
        "--cookies-from-browser",
        browserArg,
        "--cookies",
        tmpCookie,
        "--skip-download",
        "https://www.douyin.com/",
      ]);
      if (existsSync(tmpCookie)) {
        const cookies = parseNetscapeCookies(readFileSync(tmpCookie, "utf8"));
        if (cookies.length) {
          await context.addCookies(cookies);
          log?.debug("Cookie 已注入", `${cookies.length} 条`);
        }
      }
    } else if (existsSync(cookiesFilePath())) {
      const cookies = parseNetscapeCookies(readFileSync(cookiesFilePath(), "utf8"));
      if (cookies.length) {
        await context.addCookies(cookies);
        log?.debug("内置 Cookie 已注入", `${cookies.length} 条`);
      }
    }

    const page = await context.newPage();
    let videoUrl: string | null = null;
    page.on("response", async (resp) => {
      const u = resp.url();
      if (!videoUrl && /\.mp4|mime_type=video/i.test(u) && resp.status() === 200) {
        videoUrl = u;
        log?.debug("拦截到视频流", u.slice(0, 120));
      }
    });

    log?.info("打开视频页", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(5000);

    if (!videoUrl) {
      const videoEl = page.locator("video source, video").first();
      if (await videoEl.count()) {
        videoUrl = (await videoEl.getAttribute("src")) ?? null;
        if (videoUrl) log?.debug("从 video 标签获取地址", videoUrl.slice(0, 120));
      }
    }

    if (!videoUrl) throw new Error("Playwright 未能捕获视频地址");

    log?.info("curl 下载视频", videoUrl.slice(0, 100));
    await runLoggedCommand(log, "curl", "curl", ["-L", "-o", join(outDir, "video.mp4"), videoUrl]);
    if (!existsSync(join(outDir, "video.mp4"))) {
      throw new Error("视频下载失败");
    }
    log?.info("Playwright 下载完成", formatBytes(statSync(join(outDir, "video.mp4")).size));
    const pwDuration = await probeMediaDurationSec(join(outDir, "video.mp4"), log, "playwright-video");
    log?.info("Playwright 视频时长", formatDuration(pwDuration));
    log?.warn("Playwright 兜底", "若转写不全，请确保 yt-dlp 可用并升级：brew upgrade yt-dlp");
    return join(outDir, "video.mp4");
  } finally {
    await context.close();
    log?.debug("Playwright 会话已关闭");
  }
}

function parseNetscapeCookies(content: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}> {
  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict" | "None";
  }> = [];
  for (const line of content.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expires, name, value] = parts;
    cookies.push({
      name,
      value,
      domain: domain.startsWith(".") ? domain : `.${domain}`,
      path: path || "/",
      expires: Number(expires) || -1,
      httpOnly: false,
      secure: secure.toUpperCase() === "TRUE",
      sameSite: "Lax",
    });
  }
  return cookies;
}

export async function downloadDouyinVideo(shareText: string, jobDir: string, log?: JobLogger): Promise<string> {
  const url = normalizeShareText(shareText);
  const auth = await resolveDownloadAuth();
  log?.info("解析登录态", `source=${auth.kind} loggedIn=${auth.loggedIn}${auth.browserArg ? ` browser=${auth.browserArg}` : ""}`);

  const ytArgs: string[] = [];
  if (auth.kind === "chrome" && auth.browserArg) {
    ytArgs.push(...cookiesFromBrowserArgs(auth.browserArg));
  } else if ((auth.kind === "playwright" || auth.kind === "file") && auth.cookiesFile) {
    ytArgs.push("--cookies", auth.cookiesFile);
  } else {
    log?.warn("无登录 Cookie", "将尝试公开视频下载");
  }

  try {
    return await downloadWithYtDlp(url, jobDir, ytArgs, log);
  } catch (ytErr) {
    try {
      return await downloadWithPlaywright(url, jobDir, auth.browserArg, log);
    } catch (pwErr) {
      const msg = [String(ytErr), String(pwErr)].join(" | ");
      if (/login|403|cookie|auth/i.test(msg) && !auth.loggedIn) {
        const e = new Error("需要登录态：请在 Chrome 登录抖音，或使用内置扫码");
        (e as Error & { kind: string }).kind = "auth_required";
        throw e;
      }
      throw new Error(`下载失败: ${msg}`);
    }
  }
}

export { normalizeShareText };
