#!/usr/bin/env bash
set -euo pipefail
TABBY_WORKBENCH_SCRIPT="$(readlink -f -- "${BASH_SOURCE[0]}")"
TABBY_WORKBENCH_ROOT="$(cd -- "$(dirname -- "$TABBY_WORKBENCH_SCRIPT")" && pwd)"
TABBY_WORKBENCH_BIN="$TABBY_WORKBENCH_ROOT/.runtime/tabby-app/opt/Tabby/tabby"
if [ ! -x "$TABBY_WORKBENCH_BIN" ] || [ ! -f "$TABBY_WORKBENCH_ROOT/tabby/dist/index.cjs" ]; then
  printf '%s\n' '请先运行项目中的 ./setup-tabby.sh。' >&2
  exit 1
fi
export TABBY_CONFIG_DIRECTORY="${TABBY_CONFIG_DIRECTORY:-$HOME/.config/tabby-codex}"
export TABBY_REFERENCE_WORKSPACE="${TABBY_REFERENCE_WORKSPACE:-$TABBY_WORKBENCH_ROOT}"
export TABBY_CODEX_LAUNCHER="$TABBY_WORKBENCH_ROOT/scripts/codex-with-references.py"
export TABBY_REFERENCE_NODE="$TABBY_WORKBENCH_ROOT/.runtime/node_modules/node/bin/node"
mkdir -p -- "$TABBY_CONFIG_DIRECTORY"
exec "$TABBY_WORKBENCH_BIN" --user-data-dir="$TABBY_CONFIG_DIRECTORY" "$@"
