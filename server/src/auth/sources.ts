import { existsSync } from "node:fs";
import { cookiesFilePath } from "../config.js";
import type { AuthSourceKind, AuthStatus } from "../models.js";
import { resolveChromeAuth } from "./chrome.js";
import { playwrightCookiesAvailable } from "./douyin.js";
import { getAuthState, setAuthSource, normalizeSourceInput } from "./state.js";

export async function getAuthStatus(): Promise<AuthStatus> {
  const { source, chromeProfile, cookiesFile } = getAuthState();

  if (source === "chrome") {
    const chrome = await resolveChromeAuth();
    return {
      source: "chrome",
      logged_in: chrome.loggedIn,
      browser: "chrome",
      profile: chromeProfile,
      warning: chrome.warning,
      nickname: null,
    };
  }

  if (source === "playwright") {
    const ok = playwrightCookiesAvailable();
    return {
      source: "playwright",
      logged_in: ok,
      browser: "chromium",
      profile: "builtin",
      warning: ok ? null : "请完成内置扫码登录",
      nickname: null,
    };
  }

  if (source === "file") {
    const path = cookiesFile ?? cookiesFilePath();
    const ok = existsSync(path);
    return {
      source: "file",
      logged_in: ok,
      browser: null,
      profile: null,
      warning: ok ? null : `Cookie 文件不存在: ${path}`,
      nickname: null,
    };
  }

  return {
    source: "none",
    logged_in: false,
    browser: null,
    profile: null,
    warning: "未配置登录态，将仅尝试公开视频",
    nickname: null,
  };
}

export async function applyAuthSource(raw: string, cookiesFile?: string): Promise<AuthStatus> {
  const normalized = normalizeSourceInput(raw);
  setAuthSource(normalized.kind, {
    chromeProfile: normalized.chromeProfile,
    cookiesFile: cookiesFile ?? undefined,
  });
  return getAuthStatus();
}

export async function resolveDownloadAuth(): Promise<{
  kind: AuthSourceKind;
  browserArg?: string;
  cookiesFile?: string;
  loggedIn: boolean;
}> {
  const status = await getAuthStatus();
  if (status.source === "chrome" && status.logged_in) {
    const chrome = await resolveChromeAuth();
    return { kind: "chrome", browserArg: chrome.browserArg, loggedIn: true };
  }
  if (status.source === "playwright" && playwrightCookiesAvailable()) {
    return { kind: "playwright", cookiesFile: cookiesFilePath(), loggedIn: true };
  }
  if (status.source === "file") {
    const path = getAuthState().cookiesFile ?? cookiesFilePath();
    if (existsSync(path)) return { kind: "file", cookiesFile: path, loggedIn: true };
  }
  return { kind: "none", loggedIn: false };
}
