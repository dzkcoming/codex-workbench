#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/scripts/runtime.sh"
cd "$WB_ROOT"
mkdir -p data
chmod 700 data
exec flock -n data/supervisor.lock node dist/server/supervisor.js "$@"
