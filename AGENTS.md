# AGENTS.md — yk-douyin-asr

> **地位**：本仓协作真源。  
> **定位**：本地工具：抖音链接 → MiMo ASR 文案；**非** ThkTree 生产服务。  
> **规划**：[`docs/PLAN.md`](docs/PLAN.md)

---

## 技术栈

| 层 | 选型 |
|----|------|
| 后端 | **Node 20+ / TypeScript / Hono** |
| 前端 | **Vite + TypeScript** |
| 下载 | yt-dlp（`--cookies-from-browser chrome` 默认） |
| 浏览器 | Playwright Chromium（fallback 扫码 + fallback 下载） |
| 音频 | ffmpeg |
| ASR | OpenAI SDK → MiMo Token Plan `mimo-v2.5-asr` |

---

## 路径与 Git

```bash
# git toplevel
thktree-project/yk-douyin-asr/

# worktree（相对本仓 toplevel 的 ../）
thktree-project/yk-douyin-asr-worktrees/<topic>/

# 分支
yk-douyin-asr/<topic>
```

| 项 | 约定 |
|----|------|
| 用户数据 | `~/.yk-douyin-asr/`（Playwright profile、cookies.txt、auth.json） |
| 临时文件 | `/tmp/yk-douyin-asr/<job_id>/` |
| 环境变量 | 根目录 `.env` |

---

## 产品红线

| 红线 | 说明 |
|------|------|
| **Chrome Cookie 只读** | 默认 `--cookies-from-browser`；**永不**向 Chrome Profile 写入 |
| **内置扫码隔离** | Playwright 使用独立 profile；登出仅清内置数据 |
| **隐私** | 音频上传 MiMo 云端；README 必须说明 |
| **独立仓** | 不耦合 ThkTree / thktree-service |

---

## 开发命令

```bash
npm install
cp .env.example .env   # 填入 MIMO_API_KEY
npm run ensure-deps   # 仅检查/安装依赖
npm run dev            # Web UI :3900（predev 自动 ensure-deps），API :3902
npm run typecheck
npm run build
```

系统依赖：`ffmpeg`、`yt-dlp`、`npx playwright install chromium`
