#!/usr/bin/env python3
"""Append one managed service without rewriting the rest of the portal registry."""
from pathlib import Path
import socket
import subprocess
import shutil

root = Path(__file__).resolve().parents[1]
registry = Path('/media/douzhk/work/work/ai/AI_Entry/services.yaml')
entry = f'''
  - id: codex-workbench
    name: Codex 多终端调试台
    description: Shell、SSH 与串口持续采集，日志引用与 Codex 对话
    group: agent-workflow
    port: 10017
    url: "http://127.0.0.1:10017/"
    cwd: "{root}"
    start: ["./run-managed.sh", "--host", "0.0.0.0", "--port", "10017"]
    health: "/api/health"
    managed: true
    tags: [Codex, 串口, 终端]
'''
if registry.exists():
    text = registry.read_text()
    if 'id: codex-workbench' not in text:
        if 'port: 10017' in text:
            raise SystemExit('10017 已登记，请先重新分配端口')
        with socket.socket() as check:
            try:
                check.bind(('0.0.0.0', 10017))
            except OSError:
                raise SystemExit('10017 已被进程占用，请先重新分配端口')
        with registry.open('a') as out:
            out.write(entry)
        print('已登记 AI Entry：codex-workbench / 10017')
else:
    print('未找到 AI Entry；仅可用 --allow-standalone 本地调试，start.sh 需要 Portal')
desktop = Path.home() / '.local/share/applications/codex-workbench.desktop'
desktop.parent.mkdir(parents=True, exist_ok=True)
desktop.write_text(f'''[Desktop Entry]
Type=Application
Name=Codex 调试台
Comment=多终端日志与 Codex 对话
Exec="{root}/start.sh"
Path={root}
Icon=utilities-terminal
Terminal=false
Categories=Development;
''')
desktop.chmod(0o755)
print(f'应用入口：{desktop}')
try:
    desktop_dir = Path(subprocess.check_output(['xdg-user-dir', 'DESKTOP'], text=True).strip())
    if desktop_dir.is_dir() and desktop_dir != Path.home():
        icon = desktop_dir / 'codex-workbench.desktop'
        shutil.copyfile(desktop, icon)
        icon.chmod(0o755)
        print(f'桌面入口：{icon}')
except (OSError, subprocess.SubprocessError):
    pass
