# yk-douyin-asr 计划（落地版）

详见 umbrella 计划文档。本仓采用 **全栈 TypeScript** 实现。

## 架构

- **server/** — Node 20 + Hono + Playwright + OpenAI SDK
- **web/** — Vite + TypeScript 单页

## 登录态

1. 默认 Chrome `--cookies-from-browser`（只读）
2. fallback 内置 Playwright 扫码（独立 Profile）
3. 可选 cookies.txt

## 流水线

```
链接解析 → yt-dlp 下载 → ffmpeg mp3 → 分片 → MiMo ASR → 合并文本
         ↘ Playwright 下载 fallback
```

## 验收

- Chrome 已登录 → Web UI 无需额外登录即可转写
- 内置登出不影响 Chrome
- ffmpeg / yt-dlp / MIMO_API_KEY 就绪
