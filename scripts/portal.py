#!/usr/bin/env python3
"""Use the Portal lifecycle API; never launch managed processes directly."""
import json
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

action = sys.argv[1]
if action not in ('start', 'stop'):
    raise SystemExit('action 必须为 start 或 stop')
request = Request(f'http://127.0.0.1:10000/api/services/codex-workbench/{action}', data=b'{}', headers={'Content-Type': 'application/json'})
try:
    response = urlopen(request, timeout=15)
except HTTPError as error:
    response = error
except (URLError, TimeoutError) as error:
    raise SystemExit(f'AI Entry 未连接：{error}。请先启动本机 Portal。')
result = json.load(response)
if not result.get('ok'):
    message = result.get('error', str(result))
    if 'unknown service' in message:
        message += '；新登记的服务需要重启 Portal 以读取 services.yaml，已有子服务不会因此停止。'
    raise SystemExit(message)
if action == 'stop':
    print('后台已停止，历史日志保留。')
