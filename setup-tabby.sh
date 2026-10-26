#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
source scripts/runtime.sh
if [ ! -x .runtime/node_modules/node/bin/node ]; then
  printf '%s\n' '缺少项目 Node.js 22 运行时，请先按 README 安装运行时。' >&2
  exit 1
fi
if [ -x "$HOME/.nvm/versions/node/v18.20.8/bin/npm" ]; then
  TABBY_NPM="$HOME/.nvm/versions/node/v18.20.8/bin/npm"
else TABBY_NPM="$(command -v npm)"; fi
"$TABBY_NPM" ci --prefix tabby --ignore-scripts --legacy-peer-deps --no-audit --no-fund
node node_modules/typescript/bin/tsc -p tabby/tsconfig.json
node tabby/build.mjs
chmod +x start-tabby.sh scripts/codex-with-references.py
python3 scripts/install-tabby.py
