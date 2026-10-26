#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ ! -x .runtime/node_modules/node/bin/node ]; then
  if [ -x "$HOME/.nvm/versions/node/v18.20.8/bin/node" ]; then export PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH"; fi
  npm install --prefix .runtime --save-exact node@22.23.4
fi
source scripts/runtime.sh
if [ -x "$HOME/.nvm/versions/node/v18.20.8/bin/npm" ]; then
  WB_NPM="$HOME/.nvm/versions/node/v18.20.8/bin/npm"
else WB_NPM="$(command -v npm)"; fi
"$WB_NPM" ci
"$WB_NPM" run build
chmod +x start.sh stop.sh run-managed.sh
python3 scripts/register.py
