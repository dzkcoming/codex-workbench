import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { root, dataDir } from './config.js';
import { body, fail, HttpError, integer, json, terminalCall } from './http.js';
import { Codex } from './codex.js';

const arg = (name: string, fallback: string) => process.argv[process.argv.indexOf(name) + 1] || fallback;
const port = integer(process.argv.includes('--port') ? arg('--port', '10017') : undefined, 10017, 1, 65535);
const host = process.argv.includes('--host') ? arg('--host', '0.0.0.0') : '0.0.0.0';
const tokenPath = join(dataDir, 'access-token');
if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600 });
const token = readFileSync(tokenPath, 'utf8').trim();
const equal = (value: string) => Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
const codex = new Codex();
const allowed = new Set(['workspace_list', 'workspace_create', 'run_start', 'devices', 'terminal_list', 'terminal_create', 'terminal_connect', 'terminal_close', 'terminal_update', 'terminal_sessions', 'terminal_read', 'terminal_search', 'terminal_resize', 'terminal_send', 'terminal_wait', 'operation_status', 'operation_list', 'snapshot_create', 'snapshot_get']);
const staticRoot = join(root, 'dist/web');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    if (url.pathname === '/api/health') {
      const collector = await terminalCall('health', {}, 1500).catch(() => ({ ok: false }));
      return json(res, { ok: collector.ok, app: 'codex-terminal-workbench', collector: collector.ok });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw new HttpError(403, '不允许跨站请求');
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const p = await body(req);
        if (typeof p.token !== 'string' || !equal(p.token)) throw new HttpError(401, '访问口令不正确；请从 start.sh 打开页面');
        res.setHeader('Set-Cookie', `workbench=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
        return json(res, { ok: true });
      }
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('workbench='))?.slice(10) || '';
      if (!equal(cookie)) throw new HttpError(401, '请先输入本机访问口令');
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        const [workspaces, terminals, collector] = await Promise.all([terminalCall('workspace_list'), terminalCall('terminal_list'), terminalCall('health')]);
        return json(res, { workspaces, terminals, collector, codex: { status: codex.status, error: codex.error }, data_dir: dataDir });
      }
      if (url.pathname === '/api/chat' && req.method === 'GET') return json(res, codex.state(url.searchParams.get('workspace') || '', url.searchParams.get('revision') || undefined));
      if (req.method !== 'POST') throw new HttpError(405, '方法不支持');
      const p = await body(req);
      if (url.pathname === '/api/terminal') {
        if (!allowed.has(p.method)) throw new HttpError(404, '未知方法');
        return json(res, await terminalCall(p.method, { ...p.params, actor: 'human' }));
      }
      if (url.pathname === '/api/chat/send') return json(res, await codex.prompt(p));
      if (url.pathname === '/api/chat/interrupt') return json(res, await codex.interrupt());
      if (url.pathname === '/api/chat/restart') return json(res, await codex.restart());
      if (url.pathname === '/api/chat/new') {
        if (codex.active) throw new HttpError(409, '请先停止当前任务');
        return json(res, { thread_id: await codex.ensureThread(p.workspace_id, true) });
      }
      if (url.pathname === '/api/chat/answer') return json(res, codex.answer(String(p.id), p));
      if (url.pathname === '/api/logout') { res.setHeader('Set-Cookie', 'workbench=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true }); }
      throw new HttpError(404, '接口不存在');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '方法不支持');
    const file = resolve(staticRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(staticRoot + sep) || !existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, '文件不存在');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (e) { fail(res, e); }
});
server.requestTimeout = 45000;
server.listen(port, host, () => console.log(`workbench listening on ${host}:${port}`));
process.on('SIGTERM', () => { codex.child?.kill('SIGTERM'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
