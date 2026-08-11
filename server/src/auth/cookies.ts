import { writeFileSync } from "node:fs";
import type { Cookie } from "playwright";
import { cookiesFilePath } from "../config.js";

export function writeNetscapeCookies(cookies: Cookie[], path: string): void {
  const lines = ["# Netscape HTTP Cookie File", "# https://curl.haxx.se/rfc/cookie_spec.html", ""];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    lines.push([domain, includeSubdomains, c.path, secure, expires, c.name, c.value].join("\t"));
  }
  writeFileSync(path, lines.join("\n"));
}

export async function savePlaywrightCookies(cookies: Cookie[]): Promise<void> {
  const douyinCookies = cookies.filter((c) => /douyin/i.test(c.domain));
  writeNetscapeCookies(douyinCookies.length ? douyinCookies : cookies, cookiesFilePath());
}
