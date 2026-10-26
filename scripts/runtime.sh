#!/usr/bin/env bash
set -euo pipefail
WB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
if [ -x "$WB_ROOT/.runtime/node_modules/node/bin/node" ]; then
  export PATH="$WB_ROOT/.runtime/node_modules/node/bin:$PATH"
fi
export WORKBENCH_ROOT="$WB_ROOT"
