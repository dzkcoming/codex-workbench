#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/scripts/runtime.sh"
python3 "$WB_ROOT/scripts/portal.py" stop
