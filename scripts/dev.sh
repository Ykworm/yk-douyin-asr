#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export WEB_PORT=3900

echo ""
echo "  打开  →  http://localhost:${WEB_PORT}"
echo "  （启动前会自动检查并安装依赖）"
echo ""

npm run dev
