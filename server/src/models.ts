export type AuthSourceKind = "chrome" | "playwright" | "file" | "none";

export type JobStage =
  | "queued"
  | "parsing"
  | "downloading"
  | "extracting"
  | "transcribing"
  | "done"
  | "failed";

export type JobFailureKind = "auth_required" | "download_failed" | "asr_failed" | "invalid_url";

export interface AuthStatus {
  source: AuthSourceKind;
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

export type JobLogLevel = "info" | "warn" | "error" | "debug";

export interface JobLogLine {
  id: string;
  ts: string;
  level: JobLogLevel;
  stage: JobStage;
  message: string;
  detail?: string;
}

export interface JobRecord {
  id: string;
  url: string;
  stage: JobStage;
  progress: number;
  message: string;
  text: string | null;
  error: string | null;
  failure_kind: JobFailureKind | null;
  logs: JobLogLine[];
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  stage: JobStage;
  progress: number;
  message: string;
  text?: string;
  error?: string;
  failure_kind?: JobFailureKind;
  log?: JobLogLine;
}

export interface LoginSession {
  id: string;
  status: "pending" | "qr_ready" | "scanning" | "success" | "timeout" | "failed";
  qr_base64: string | null;
  message: string;
  created_at: number;
}

export interface SetAuthSourceBody {
  source: string;
  cookies_file?: string;
}
