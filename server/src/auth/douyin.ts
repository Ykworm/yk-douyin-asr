import { existsSync, rmSync, mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import { chromiumProfilePath, config, cookiesFilePath } from "../config.js";
import type { LoginSession } from "../models.js";
import { savePlaywrightCookies } from "./cookies.js";

const loginSessions = new Map<string, LoginSession>();
let activeContext: BrowserContext | null = null;

async function persistContextCookies(context: BrowserContext): Promise<void> {
  mkdirSync(config.dataDir, { recursive: true });
  await savePlaywrightCookies(await context.cookies());
}

async function findQrBase64(page: Page): Promise<string | null> {
  const selectors = [
    "canvas",
    "img[src*='qr']",
    "img[class*='qr']",
    "[class*='qrcode'] img",
    "[class*='login'] canvas",
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      try {
        const buf = await el.screenshot();
        return buf.toString("base64");
      } catch {
        /* try next */
      }
    }
  }
  const full = await page.screenshot({ fullPage: false });
  return full.toString("base64");
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/passport|login/i.test(url)) return false;
  const avatar = page.locator("[class*='avatar'], [data-e2e='user-avatar']").first();
  if (await avatar.count()) return true;
  const cookies = await page.context().cookies("https://www.douyin.com");
  return cookies.some((c) => c.name === "sessionid" || c.name === "sid_tt");
}

export function getLoginSession(id: string): LoginSession | undefined {
  return loginSessions.get(id);
}

export async function startPlaywrightLogin(): Promise<LoginSession> {
  const id = uuidv4();
  const session: LoginSession = {
    id,
    status: "pending",
    qr_base64: null,
    message: "正在启动浏览器…",
    created_at: Date.now(),
  };
  loginSessions.set(id, session);

  void (async () => {
    try {
      mkdirSync(chromiumProfilePath(), { recursive: true });
      const headless = true;
      let context = await chromium.launchPersistentContext(chromiumProfilePath(), {
        headless,
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      });
      activeContext = context;
      let page = context.pages()[0] ?? (await context.newPage());
      await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

      if (await isLoggedIn(page)) {
        session.status = "success";
        session.message = "已登录";
        await persistContextCookies(context);
        return;
      }

      const loginBtn = page.locator("text=登录").first();
      if (await loginBtn.count()) {
        await loginBtn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
      }

      let qr = await findQrBase64(page);
      if (!qr && config.douyinLoginHeadfulFallback) {
        await context.close();
        context = await chromium.launchPersistentContext(chromiumProfilePath(), {
          headless: false,
          viewport: { width: 1280, height: 800 },
        });
        activeContext = context;
        page = context.pages()[0] ?? (await context.newPage());
        await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        const btn = page.locator("text=登录").first();
        if (await btn.count()) await btn.click().catch(() => undefined);
        await page.waitForTimeout(2000);
        qr = await findQrBase64(page);
        session.message = "已打开可见浏览器窗口，请在窗口中完成登录";
      }

      if (qr) {
        session.status = "qr_ready";
        session.qr_base64 = qr;
        session.message = "请使用抖音 App 扫描二维码";
      } else {
        session.status = "scanning";
        session.message = "等待登录完成…";
      }

      const deadline = Date.now() + config.douyinLoginTimeoutSec * 1000;
      while (Date.now() < deadline) {
        if (await isLoggedIn(page)) {
          session.status = "success";
          session.message = "登录成功";
          await persistContextCookies(context);
          await context.close().catch(() => undefined);
          activeContext = null;
          return;
        }
        if (session.status === "qr_ready") session.status = "scanning";
        if (!session.qr_base64) {
          session.qr_base64 = await findQrBase64(page);
        }
        await page.waitForTimeout(2000);
      }

      session.status = "timeout";
      session.message = "登录超时，请重试";
      await context.close().catch(() => undefined);
      activeContext = null;
    } catch (err) {
      session.status = "failed";
      session.message = err instanceof Error ? err.message : String(err);
      await activeContext?.close().catch(() => undefined);
      activeContext = null;
    }
  })();

  return session;
}

export async function logoutPlaywright(): Promise<void> {
  await activeContext?.close().catch(() => undefined);
  activeContext = null;
  if (existsSync(chromiumProfilePath())) {
    rmSync(chromiumProfilePath(), { recursive: true, force: true });
  }
  if (existsSync(cookiesFilePath())) {
    rmSync(cookiesFilePath(), { force: true });
  }
}

export function playwrightCookiesAvailable(): boolean {
  return existsSync(cookiesFilePath());
}
