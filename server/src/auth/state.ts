import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { authStatePath } from "../config.js";
import type { AuthSourceKind } from "../models.js";

interface PersistedAuthState {
  source: AuthSourceKind;
  chromeProfile: string;
  cookiesFile: string | null;
}

let state: PersistedAuthState = loadState();

function loadState(): PersistedAuthState {
  try {
    if (existsSync(authStatePath())) {
      return JSON.parse(readFileSync(authStatePath(), "utf8")) as PersistedAuthState;
    }
  } catch {
    /* use defaults */
  }
  return { source: "chrome", chromeProfile: "Default", cookiesFile: null };
}

function saveState(): void {
  mkdirSync(authStatePath().replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(authStatePath(), JSON.stringify(state, null, 2));
}

export function getAuthState(): PersistedAuthState {
  return { ...state };
}

export function setAuthSource(source: AuthSourceKind, opts?: { chromeProfile?: string; cookiesFile?: string | null }): void {
  state.source = source;
  if (opts?.chromeProfile) state.chromeProfile = opts.chromeProfile;
  if (opts?.cookiesFile !== undefined) state.cookiesFile = opts.cookiesFile;
  saveState();
}

export function chromeBrowserArg(profile?: string): string {
  const p = profile ?? state.chromeProfile;
  return p === "Default" ? "chrome" : `chrome:${p}`;
}

export function normalizeSourceInput(raw: string): { kind: AuthSourceKind; chromeProfile?: string } {
  if (raw === "playwright") return { kind: "playwright" };
  if (raw === "file") return { kind: "file" };
  if (raw === "none") return { kind: "none" };
  if (raw === "chrome" || raw.startsWith("chrome:")) {
    const profile = raw === "chrome" ? "Default" : raw.slice("chrome:".length);
    return { kind: "chrome", chromeProfile: profile };
  }
  return { kind: "chrome", chromeProfile: raw };
}
