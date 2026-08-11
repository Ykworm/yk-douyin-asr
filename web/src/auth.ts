import { apiPath } from "./api.js";

export interface AuthStatus {
  source: "chrome" | "playwright" | "file" | "none";
  logged_in: boolean;
  browser: string | null;
  profile: string | null;
  warning: string | null;
  nickname: string | null;
}

export interface BrowserProfileInfo {
  id: string;
  label: string;
  has_douyin_cookie: boolean;
  readable: boolean;
  error: string | null;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(apiPath("/auth/douyin/status"));
  if (!res.ok) throw new Error(`登录态检查失败 (${res.status})`);
  return res.json();
}

export async function fetchBrowsers(): Promise<BrowserProfileInfo[]> {
  const res = await fetch(apiPath("/auth/douyin/browsers"));
  if (!res.ok) throw new Error(`浏览器探测失败 (${res.status})`);
  const data = (await res.json()) as { browsers: BrowserProfileInfo[] };
  return data.browsers;
}

export async function setAuthSource(source: string): Promise<AuthStatus> {
  const res = await fetch(apiPath("/auth/douyin/source"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) throw new Error(`切换来源失败 (${res.status})`);
  return res.json();
}

export async function startBuiltinLogin(): Promise<{ session_id: string }> {
  const res = await fetch(apiPath("/auth/douyin/login/start"), { method: "POST" });
  if (!res.ok) throw new Error(`启动扫码失败 (${res.status})`);
  return res.json();
}

export function subscribeLoginEvents(
  sessionId: string,
  onUpdate: (data: { status: string; message: string; qr_base64: string | null }) => void,
): () => void {
  const es = new EventSource(apiPath(`/auth/douyin/login/${sessionId}/events`));
  es.addEventListener("update", (ev) => onUpdate(JSON.parse(ev.data)));
  es.addEventListener("heartbeat", (ev) => onUpdate(JSON.parse(ev.data)));
  es.addEventListener("error", () => es.close());
  return () => es.close();
}

export async function logoutBuiltin(): Promise<void> {
  await fetch(apiPath("/auth/douyin/logout"), { method: "POST" });
}

export function renderAuthSection(root: HTMLElement, onChange: () => void): void {
  root.innerHTML = `
    <div class="auth-bar">
      <span id="auth-badge" class="badge">检测登录态…</span>
      <select id="auth-source" class="secondary" style="width:auto;min-width:180px"></select>
      <button id="auth-builtin" class="secondary" type="button">内置扫码</button>
      <button id="auth-logout" class="secondary hidden" type="button">断开内置会话</button>
    </div>
    <div id="auth-hint" class="hint"></div>
    <div id="qr-area" class="qr-wrap hidden"></div>
  `;

  const badge = root.querySelector<HTMLElement>("#auth-badge")!;
  const hint = root.querySelector<HTMLElement>("#auth-hint")!;
  const select = root.querySelector<HTMLSelectElement>("#auth-source")!;
  const builtinBtn = root.querySelector<HTMLButtonElement>("#auth-builtin")!;
  const logoutBtn = root.querySelector<HTMLButtonElement>("#auth-logout")!;
  const qrArea = root.querySelector<HTMLElement>("#qr-area")!;

  async function refresh(): Promise<void> {
    try {
      const [status, browsers] = await Promise.all([fetchAuthStatus(), fetchBrowsers()]);
      select.innerHTML = browsers
        .map(
          (b) =>
            `<option value="${b.id}">Chrome ${b.label}${b.has_douyin_cookie ? " ✓" : ""}</option>`,
        )
        .concat([
          `<option value="playwright">内置 Playwright 会话</option>`,
          `<option value="none">无登录态（仅公开视频）</option>`,
        ])
        .join("");

      if (status.source === "chrome" && status.profile && status.profile !== "Default") {
        select.value = `chrome:${status.profile}`;
      } else if (status.source === "chrome") {
        const match = browsers.find((b) => b.has_douyin_cookie);
        select.value = match?.id ?? "chrome";
      } else {
        select.value = status.source;
      }

      if (status.logged_in) {
        badge.className = "badge ok";
        badge.textContent =
          status.source === "chrome"
            ? `✓ Chrome 登录态（${status.profile ?? "Default"}）`
            : status.source === "playwright"
              ? "✓ 内置会话已登录"
              : "✓ 已配置登录态";
      } else if (status.warning?.includes("yt-dlp")) {
        badge.className = "badge warn";
        badge.textContent = "缺少 yt-dlp";
      } else if (status.warning?.includes("磁盘访问")) {
        badge.className = "badge warn";
        badge.textContent = "需要磁盘访问权限";
      } else {
        badge.className = "badge warn";
        badge.textContent = "未检测到有效登录态";
      }

      hint.textContent =
        status.warning ??
        (status.source === "chrome"
          ? "默认只读借用 Chrome Cookie，不会登出 Chrome。"
          : "可切换来源或使用内置扫码。");

      logoutBtn.classList.toggle("hidden", status.source !== "playwright");
    } catch (err) {
      badge.className = "badge warn";
      badge.textContent = "API 连接失败";
      hint.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  select.addEventListener("change", async () => {
    if (select.value === "playwright") {
      const ok = confirm(
        "将在独立浏览器会话中登录，通常不会影响 Chrome。若抖音触发安全验证，所有端可能需要重新登录。继续？",
      );
      if (!ok) {
        await refresh();
        return;
      }
    }
    await setAuthSource(select.value);
    await refresh();
    onChange();
  });

  builtinBtn.addEventListener("click", async () => {
    const ok = confirm("启动内置扫码登录？通常不会影响 Chrome 已有登录。");
    if (!ok) return;
    qrArea.classList.remove("hidden");
    qrArea.innerHTML = "<p>正在启动…</p>";
    const { session_id } = await startBuiltinLogin();
    subscribeLoginEvents(session_id, (data) => {
      qrArea.innerHTML = `<p>${data.message}</p>`;
      if (data.qr_base64) {
        qrArea.innerHTML += `<img alt="登录二维码" src="data:image/png;base64,${data.qr_base64}" />`;
      }
      if (data.status === "success" || data.status === "timeout" || data.status === "failed") {
        void refresh().then(onChange);
        if (data.status !== "success") return;
        setTimeout(() => qrArea.classList.add("hidden"), 1500);
      }
    });
  });

  logoutBtn.addEventListener("click", async () => {
    await logoutBuiltin();
    await refresh();
    onChange();
  });

  void refresh();
}
