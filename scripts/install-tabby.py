#!/usr/bin/env python3
"""Install the official Tabby portable files and our plugin, without system package changes."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import urllib.request

root = Path(__file__).resolve().parent.parent
version = '1.0.238'
filename = f'tabby-{version}-linux-x64.deb'
expected = '5ea2b9aa84f2b5cdcb98cb7e94bd3d92de48c96254a98b52bf2d1f30a52d1d1c'
runtime = root / '.runtime'
archive = runtime / filename
target = runtime / 'tabby-app'
if os.uname().machine != 'x86_64':
    raise SystemExit('This installer currently packages Linux x86_64 Tabby only.')

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

if not archive.exists():
    url = f'https://github.com/Eugeny/tabby/releases/download/v{version}/{filename}'
    temporary = archive.with_suffix('.partial')
    print(f'Downloading official Tabby {version}…', flush=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'Tabby-Codex-Workbench'})
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as stream:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            stream.write(chunk)
    if digest(temporary) != expected:
        raise SystemExit('Downloaded package does not match the tested artifact SHA-256.')
    temporary.replace(archive)
if digest(archive) != expected:
    raise SystemExit('Cached Tabby package does not match the tested artifact SHA-256.')
if not (target / 'opt/Tabby/tabby').is_file():
    target.mkdir(exist_ok=True)
    subprocess.run(['dpkg-deb', '-x', str(archive), str(target)], check=True)

config = Path(os.environ.get('TABBY_CONFIG_DIRECTORY', str(Path.home() / '.config/tabby-codex')))
config.mkdir(parents=True, exist_ok=True)
plugins = config / 'plugins/node_modules'
plugins.mkdir(parents=True, exist_ok=True)
link = plugins / 'tabby-codex-references'
if link.is_symlink():
    if link.resolve() != root / 'tabby':
        raise SystemExit(f'A different plugin already uses {link}; existing installation was preserved.')
elif link.exists():
    raise SystemExit(f'Existing plugin directory was preserved: {link}')
else:
    link.symlink_to(root / 'tabby', target_is_directory=True)

config_file = config / 'config.yaml'
if not config_file.exists():
    config_file.write_text('version: 7\nenableWelcomeTab: false\nenableAnalytics: false\n'
        'hotkeys:\n  toggle-window: []\n  rearrange-panes: []\nterminal:\n  rightClick: menu\n'
        'codexReferences:\n  enabled: true\n  workspace: ' + json.dumps(str(root), ensure_ascii=False) + '\n')
    config_file.chmod(0o600)

bin_dir = Path.home() / '.local/bin'
bin_dir.mkdir(parents=True, exist_ok=True)
command = bin_dir / 'tabby'
if not command.exists() and not command.is_symlink():
    command.symlink_to(root / 'start-tabby.sh')

applications = Path.home() / '.local/share/applications'
applications.mkdir(parents=True, exist_ok=True)
icon = target / 'usr/share/icons/hicolor/256x256/apps/tabby.png'
if not icon.exists():
    icons = list(target.glob('usr/share/icons/**/tabby.png'))
    icon = icons[0] if icons else Path('utilities-terminal')
exec_path = str(root / 'start-tabby.sh').replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
entry = ('[Desktop Entry]\nType=Application\nName=Tabby · Codex 引用\n'
    'Comment=原版 Codex 与多终端固定引用\n'
    f'Exec="{exec_path}"\nPath={root}\nIcon={icon}\nTerminal=false\nCategories=Development;TerminalEmulator;\n')
destinations = [applications / 'tabby-codex-references.desktop']
desktop_query = subprocess.run(['xdg-user-dir', 'DESKTOP'], text=True, capture_output=True)
if desktop_query.returncode == 0:
    desktop = Path(desktop_query.stdout.strip())
    if desktop.is_dir() and desktop != Path.home():
        destinations.append(desktop / 'tabby-codex-references.desktop')
for destination in destinations:
    destination.write_text(entry)
    destination.chmod(0o700)
    subprocess.run(['gio', 'set', str(destination), 'metadata::trusted', 'true'], capture_output=True)
subprocess.run(['update-desktop-database', str(applications)], capture_output=True)
print(f'Tabby {version} and the reference plugin are installed.')
print(f'Launch: {root / "start-tabby.sh"}')
print(f'Plugin settings: {config_file}')
