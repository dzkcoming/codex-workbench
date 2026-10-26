#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/scripts/runtime.sh"
if [ ! -f "$WB_ROOT/dist/web/index.html" ]; then
  echo '请先运行 ./setup.sh 安装依赖并构建。' >&2
  exit 1
fi
python3 "$WB_ROOT/scripts/portal.py" start
WB_READY=0
for _ in {1..50}; do
  if curl --fail --silent --max-time 1 http://127.0.0.1:10017/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") else 1)' 2>/dev/null; then WB_READY=1; break; fi
  sleep 0.2
done
if [ "$WB_READY" != 1 ]; then echo '后台未就绪，请查看 AI Entry 的 run/codex-workbench.log。' >&2; exit 1; fi
echo 'Codex 调试台：http://127.0.0.1:10017/'
if [ "${1:-}" != '--no-open' ]; then
  WB_TOKEN="$(cat "$WB_ROOT/data/access-token")"
  xdg-open "http://127.0.0.1:10017/#token=$WB_TOKEN" >/dev/null 2>&1 &
fi
