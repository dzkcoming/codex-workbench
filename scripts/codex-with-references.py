#!/usr/bin/env python3
"""Run the user's normal Codex CLI with an additional, process-local read-only MCP."""
import json
import os
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
workspace = Path.cwd()
if args[:1] == ['--workspace']:
    if len(args) < 2:
        raise SystemExit('--workspace requires a directory')
    workspace = Path(args[1]).expanduser().resolve()
    args = args[2:]
if args[:1] == ['--']:
    args = args[1:]
if not workspace.is_dir():
    raise SystemExit(f'Project directory does not exist: {workspace}')
codex = os.environ.get('CODEX_BIN') or shutil.which('codex') or str(Path.home() / '.local/bin/codex')
node = root / '.runtime/node_modules/node/bin/node'
if not node.is_file():
    raise SystemExit('Project Node runtime is missing; run setup.sh first')
bridge = root / 'tabby/dist/mcp.cjs'
if not bridge.is_file():
    raise SystemExit('Reference plugin is not built; run setup-tabby.sh first')
settings = {
    'mcp_servers.terminal_references.command': str(node),
    'mcp_servers.terminal_references.args': [str(bridge), '--workspace', str(workspace)],
    'mcp_servers.terminal_references.enabled': True,
}
argv = [codex, '--cd', str(workspace)]
for key, value in settings.items():
    argv.extend(['--config', key + '=' + json.dumps(value, ensure_ascii=False)])
argv.extend(args)
os.execv(codex, argv)
