#!/usr/bin/env bash
# 检查并自动安装 yk-douyin-asr 所需依赖（npm / Homebrew / Playwright）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { echo "[ensure-deps] $*"; }
warn() { echo "[ensure-deps] 警告: $*" >&2; }

need_node_major=20

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node >= ${need_node_major}: https://nodejs.org/" >&2
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if (( node_major < need_node_major )); then
  echo "需要 Node >= ${need_node_major}，当前: $(node -v)" >&2
  exit 1
fi
log "✓ Node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm" >&2
  exit 1
fi

install_brew_pkg() {
  local bin_name=$1
  local formula=${2:-$1}

  if command -v "$bin_name" >/dev/null 2>&1; then
    log "✓ ${bin_name} ($(${bin_name} --version 2>/dev/null | head -1 || echo ok))"
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    echo "缺少 ${bin_name}，且未安装 Homebrew。请先安装 Homebrew 后执行: brew install ${formula}" >&2
    exit 1
  fi

  log "安装 ${formula} ..."
  brew install "${formula}"
  log "✓ ${bin_name} 已安装"
}

install_brew_pkg ffmpeg ffmpeg
install_brew_pkg yt-dlp yt-dlp

log "npm install ..."
npm install
log "✓ npm 依赖"

log "Playwright Chromium（fallback 下载 / 内置扫码）..."
if npm exec -w server -- playwright install chromium; then
  log "✓ Playwright Chromium"
else
  warn "Playwright Chromium 安装失败，fallback 功能可能不可用"
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    log "已从 .env.example 创建 .env — 请编辑 MIMO_API_KEY"
  else
    warn "未找到 .env，请手动配置 MIMO_API_KEY"
  fi
elif ! grep -q '^MIMO_API_KEY=.\+' .env 2>/dev/null; then
  warn ".env 中 MIMO_API_KEY 未配置，转写将无法调用 ASR"
fi

log "依赖检查完成"
