import { synthesizeYujie, wavBlobFromBase64 } from "./tts.js";

export function createAudioPlayer(wrap: HTMLElement, player: HTMLAudioElement, downloadBtn: HTMLButtonElement) {
  let audioUrl: string | null = null;

  const reset = () => {
    wrap.classList.add("hidden");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    player.removeAttribute("src");
  };

  downloadBtn.addEventListener("click", () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "yujie-speech.wav";
    a.click();
  });

  return {
    reset,
    async play(text: string, onStatus: (msg: string) => void): Promise<void> {
      onStatus("御姐音色合成中…");
      const result = await synthesizeYujie(text);
      const blob = wavBlobFromBase64(result.audio_base64);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
      player.src = audioUrl;
      wrap.classList.remove("hidden");
      void player.play();
      onStatus(`朗读就绪（${result.chunks} 段 · ${text.length} 字）`);
    },
  };
}

export function initTabs(
  nav: HTMLElement,
  panelRoot: ParentNode,
  onChange: (tab: "douyin" | "read") => void,
): void {
  const switchTo = (tab: "douyin" | "read", activeBtn: HTMLButtonElement) => {
    nav.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
    activeBtn.classList.add("active");
    panelRoot.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tab);
    });
    onChange(tab);
  };

  nav.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTo(btn.dataset.tab as "douyin" | "read", btn);
    });
  });
}
