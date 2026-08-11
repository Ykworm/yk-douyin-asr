import { stageLabel } from "./transcribe.js";

export type JobLogLevel = "info" | "warn" | "error" | "debug";

export interface JobLogLine {
  id: string;
  ts: string;
  level: JobLogLevel;
  stage: string;
  message: string;
  detail?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function levelLabel(level: JobLogLevel): string {
  const map: Record<JobLogLevel, string> = {
    info: "INFO",
    warn: "WARN",
    error: "ERR",
    debug: "DBG",
  };
  return map[level] ?? level.toUpperCase();
}

export function createLogPanel(container: HTMLElement): {
  clear: () => void;
  append: (lines: JobLogLine[]) => void;
  appendOne: (line: JobLogLine) => void;
  sync: (lines: JobLogLine[]) => void;
} {
  const seen = new Set<string>();
  let autoScroll = true;

  container.innerHTML = `
    <div class="log-toolbar">
      <span class="log-count">0 条</span>
      <label class="log-autoscroll">
        <input type="checkbox" checked />
        自动滚动
      </label>
    </div>
    <div class="log-viewport" tabindex="0"></div>
  `;

  const countEl = container.querySelector<HTMLElement>(".log-count")!;
  const viewport = container.querySelector<HTMLElement>(".log-viewport")!;
  const checkbox = container.querySelector<HTMLInputElement>(".log-autoscroll input")!;

  checkbox.addEventListener("change", () => {
    autoScroll = checkbox.checked;
  });

  viewport.addEventListener("scroll", () => {
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
    if (!nearBottom && autoScroll) {
      autoScroll = false;
      checkbox.checked = false;
    }
  });

  const renderLine = (line: JobLogLine): HTMLElement => {
    const row = document.createElement("div");
    row.className = `log-line log-${line.level}`;
    row.dataset.id = line.id;

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatTime(line.ts);

    const level = document.createElement("span");
    level.className = "log-level";
    level.textContent = levelLabel(line.level);

    const stage = document.createElement("span");
    stage.className = "log-stage";
    stage.textContent = stageLabel(line.stage);

    const msg = document.createElement("span");
    msg.className = "log-msg";
    msg.textContent = line.message;

    row.append(time, level, stage, msg);

    if (line.detail) {
      const detail = document.createElement("div");
      detail.className = "log-detail";
      detail.textContent = line.detail;
      row.appendChild(detail);
    }

    return row;
  };

  const scrollToBottom = () => {
    if (autoScroll) viewport.scrollTop = viewport.scrollHeight;
  };

  const addLine = (line: JobLogLine): boolean => {
    if (seen.has(line.id)) return false;
    seen.add(line.id);
    viewport.appendChild(renderLine(line));
    countEl.textContent = `${seen.size} 条`;
    scrollToBottom();
    return true;
  };

  return {
    clear() {
      seen.clear();
      viewport.innerHTML = "";
      countEl.textContent = "0 条";
    },
    append(lines) {
      let added = 0;
      for (const line of lines) {
        if (addLine(line)) added++;
      }
      if (added === 0) return;
    },
    appendOne(line) {
      addLine(line);
    },
    sync(lines) {
      for (const line of lines) addLine(line);
    },
  };
}
