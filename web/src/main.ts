import { apiPath } from "./api.js";
import { renderAuthSection } from "./auth.js";
import { createLogPanel } from "./log-panel.js";
import { mdToSpeechText } from "./md-speech.js";
import { createAudioPlayer, initTabs } from "./read-tab.js";
import { applyJobUpdate, createJob, fetchJob, pollJob, renderProgress, subscribeJob, type JobLogLine } from "./transcribe.js";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app")!;

app.innerHTML = `
  <header>
    <div>
      <h1>yk-douyin-asr</h1>
      <p class="subtitle">抖音转写 · Markdown 御姐朗读</p>
    </div>
  </header>

  <nav class="tabs" id="main-tabs">
    <button type="button" class="tab active" data-tab="douyin">抖音转写</button>
    <button type="button" class="tab" data-tab="read">Markdown 朗读</button>
  </nav>

  <div data-tab-panel="douyin" id="panel-douyin">
    <section class="panel" id="auth-panel"></section>

    <section class="panel">
      <label for="url-input">抖音分享链接 / 口令</label>
      <textarea id="url-input" placeholder="粘贴 https://v.douyin.com/... 或完整分享口令"></textarea>
      <div class="actions" style="margin-top:12px">
        <button id="submit-btn" type="button">开始转写</button>
      </div>
      <div id="progress-steps" class="steps hidden"></div>
      <p id="status-line" class="hint"></p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <label>运行日志</label>
        <span class="hint">流水线每步实时输出</span>
      </div>
      <div id="log-panel" class="log-panel"></div>
    </section>

    <section class="panel">
      <label>转写结果</label>
      <div id="result" class="result">等待任务…</div>
      <div class="actions">
        <button id="copy-btn" class="secondary" type="button" disabled>复制文案</button>
        <button id="download-btn" class="secondary" type="button" disabled>下载 .md</button>
        <button id="speak-btn" class="secondary" type="button" disabled>御姐朗读</button>
      </div>
    </section>
  </div>

  <div data-tab-panel="read" id="panel-read" class="hidden">
    <section class="panel">
      <label for="md-input">粘贴 Markdown / 纯文本</label>
      <textarea id="md-input" class="md-input" placeholder="# 标题&#10;&#10;把任何 .md 或文章粘贴到这里，御姐读给你听…"></textarea>
      <label class="checkbox-row">
        <input id="strip-md" type="checkbox" checked />
        朗读前去掉 Markdown 符号（保留文字内容）
      </label>
      <p class="hint" style="margin-top:8px">使用预置音色「冰糖」+ 御姐风格，按原文逐字朗读，不会改写内容。</p>
      <div class="actions" style="margin-top:12px">
        <button id="read-btn" type="button">御姐朗读</button>
      </div>
      <p id="read-status" class="hint">支持转写后的 .md，或任意复制的内容</p>
    </section>
  </div>

  <section class="panel" id="audio-panel">
    <label>语音播放</label>
    <div id="audio-wrap" class="audio-wrap hidden">
      <audio id="tts-player" controls></audio>
      <button id="download-audio-btn" class="secondary" type="button">下载 .wav</button>
    </div>
    <p id="audio-hint" class="hint">合成完成后在此播放</p>
  </section>
`;

const authPanel = document.querySelector<HTMLElement>("#auth-panel")!;
const urlInput = document.querySelector<HTMLTextAreaElement>("#url-input")!;
const submitBtn = document.querySelector<HTMLButtonElement>("#submit-btn")!;
const progressSteps = document.querySelector<HTMLElement>("#progress-steps")!;
const statusLine = document.querySelector<HTMLElement>("#status-line")!;
const logPanelEl = document.querySelector<HTMLElement>("#log-panel")!;
const resultBox = document.querySelector<HTMLElement>("#result")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copy-btn")!;
const downloadBtn = document.querySelector<HTMLButtonElement>("#download-btn")!;
const speakBtn = document.querySelector<HTMLButtonElement>("#speak-btn")!;
const mdInput = document.querySelector<HTMLTextAreaElement>("#md-input")!;
const stripMd = document.querySelector<HTMLInputElement>("#strip-md")!;
const readBtn = document.querySelector<HTMLButtonElement>("#read-btn")!;
const readStatus = document.querySelector<HTMLElement>("#read-status")!;
const audioWrap = document.querySelector<HTMLElement>("#audio-wrap")!;
const ttsPlayer = document.querySelector<HTMLAudioElement>("#tts-player")!;
const downloadAudioBtn = document.querySelector<HTMLButtonElement>("#download-audio-btn")!;
const audioHint = document.querySelector<HTMLElement>("#audio-hint")!;
const mainTabs = document.querySelector<HTMLElement>("#main-tabs")!;

let latestText = "";
const logPanel = createLogPanel(logPanelEl);
const audioPlayer = createAudioPlayer(audioWrap, ttsPlayer, downloadAudioBtn);

renderAuthSection(authPanel, () => undefined);

initTabs(mainTabs, app, (tab) => {
  audioHint.textContent = tab === "read" ? "Markdown 朗读结果在此播放" : "转写结果朗读在此播放";
});

async function runYujieTts(raw: string, onStatus: (msg: string) => void): Promise<void> {
  const text = raw.trim();
  if (!text) throw new Error("内容为空");
  audioPlayer.reset();
  await audioPlayer.play(text, (msg) => {
    onStatus(msg);
    audioHint.textContent = msg;
  });
}

submitBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  submitBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  speakBtn.disabled = true;
  audioPlayer.reset();
  latestText = "";
  resultBox.textContent = "";
  logPanel.clear();
  progressSteps.classList.remove("hidden");

  let stopSse: () => void = () => undefined;
  let stopPoll: () => void = () => undefined;
  let jobId = "";
  let finished = false;

  const jobHandlers = {
    onProgress: (update: { stage: string; progress: number; message: string }) => {
      renderProgress(progressSteps, update.stage);
      statusLine.textContent = `${update.message} (${update.progress}%)`;
    },
    onLogs: (logs: JobLogLine[]) => logPanel.sync(logs),
    onLog: (line: JobLogLine) => {
      logPanel.appendOne(line);
      if (line.message === "任务完成" || line.message === "任务失败") {
        void fetchJob(jobId).then((j) => {
          if (j && !finished) finished = applyJobUpdate(j, jobHandlers);
        });
      }
    },
    onDone: async (text: string) => {
      latestText = text;
      resultBox.textContent = text || "（转写完成，但未识别到文字）";
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
      speakBtn.disabled = false;
      submitBtn.disabled = false;
      renderProgress(progressSteps, "done");
      statusLine.textContent = "完成 (100%)";
      stopPoll();
      stopSse();
      const finalJob = await fetchJob(jobId);
      if (finalJob?.logs?.length) logPanel.sync(finalJob.logs);
    },
    onFailed: async (update: { error?: string | null; failure_kind?: string | null }) => {
      resultBox.textContent = update.error ?? "转写失败";
      statusLine.textContent = update.failure_kind === "auth_required" ? "请先配置 Chrome 或内置登录" : "失败";
      submitBtn.disabled = false;
      renderProgress(progressSteps, "failed");
      stopPoll();
      stopSse();
      if (jobId) {
        const finalJob = await fetchJob(jobId);
        if (finalJob?.logs?.length) logPanel.sync(finalJob.logs);
      }
    },
  };

  try {
    const job = await createJob(url);
    jobId = job.id;
    jobHandlers.onProgress(job);
    if (job.logs?.length) logPanel.sync(job.logs);

    finished = applyJobUpdate(job, jobHandlers);
    if (finished) return;

    stopPoll = pollJob(job.id, {
      onUpdate: (j) => {
        if (finished) return;
        finished = applyJobUpdate(j, jobHandlers);
      },
      onLogs: (logs) => logPanel.sync(logs),
    });

    stopSse = subscribeJob(job.id, {
      onUpdate: (update) => {
        if (finished) return;
        finished = applyJobUpdate(update, jobHandlers);
      },
      onLog: (line) => {
        logPanel.appendOne(line);
        if (line.message === "任务完成" || line.message === "任务失败") {
          void fetchJob(job.id).then((j) => {
            if (j && !finished) finished = applyJobUpdate(j, jobHandlers);
          });
        }
      },
    });
  } catch (err) {
    resultBox.textContent = err instanceof Error ? err.message : String(err);
    submitBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  if (!latestText) return;
  await navigator.clipboard.writeText(latestText);
  statusLine.textContent = "已复制到剪贴板";
});

downloadBtn.addEventListener("click", () => {
  if (!latestText) return;
  const blob = new Blob([`# 抖音转写\n\n${latestText}\n`], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "douyin-transcript.md";
  a.click();
  URL.revokeObjectURL(a.href);
});

speakBtn.addEventListener("click", async () => {
  if (!latestText) return;
  speakBtn.disabled = true;
  try {
    await runYujieTts(latestText, (msg) => {
      statusLine.textContent = msg;
    });
  } catch (err) {
    statusLine.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    speakBtn.disabled = false;
  }
});

readBtn.addEventListener("click", async () => {
  const raw = mdInput.value.trim();
  if (!raw) return;
  readBtn.disabled = true;
  try {
    const text = stripMd.checked ? mdToSpeechText(raw) : raw;
    await runYujieTts(text, (msg) => {
      readStatus.textContent = msg;
    });
  } catch (err) {
    readStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    readBtn.disabled = false;
  }
});

fetch(apiPath("/health"))
  .then((r) => r.json())
  .then((h) => {
    if (!h.ffmpeg || !h.ytdlp) {
      statusLine.textContent = "警告：请安装 ffmpeg 与 yt-dlp";
    } else if (!h.mimo?.ok) {
      statusLine.textContent = "警告：请在 .env 配置 MIMO_API_KEY";
    }
  })
  .catch(() => undefined);

fetch(apiPath("/tts"))
  .then((r) => {
    if (!r.ok) readStatus.textContent = "TTS 接口未就绪，请重启 dev 服务（./scripts/dev.sh）";
  })
  .catch(() => undefined);
