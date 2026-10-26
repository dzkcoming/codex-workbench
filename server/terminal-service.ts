import http from 'node:http';
import { chmodSync, existsSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { SerialPort } from 'serialport';
import { dataDir, socketPath, uid, now, root } from './config.js';
import { Store } from './store.js';
import { body, fail, HttpError, integer, json, required, terminalCall } from './http.js';

type Live = { sid: string; pty?: IPty; serial?: SerialPort; closing: boolean; queue: Promise<unknown>; generation: number; queued: number };
export class TerminalService {
  live = new Map<string, Live>();
  fatal: string | null = null;
  constructor(public store: Store) { store.recover(); }
  async dispatch(method: string, p: any = {}): Promise<any> {
    switch (method) {
      case 'health': return { ok: !this.fatal, pid: process.pid, error: this.fatal, live: this.live.size };
      case 'workspace_list': return this.store.all('SELECT * FROM workspaces ORDER BY rowid');
      case 'workspace_create': {
        const cwd = realpathSync(required(p.cwd, '目录'));
        if (!statSync(cwd).isDirectory()) throw new HttpError(400, '工作目录不存在');
        const id = uid(); this.store.run('INSERT INTO workspaces VALUES(?,?,?,?)', id, required(p.name, '项目名', 80), cwd, uid());
        return this.store.workspace(id);
      }
      case 'run_start': {
        this.store.workspace(p.workspace_id); const run = uid();
        this.store.run('UPDATE workspaces SET run_id=? WHERE id=?', run, p.workspace_id); return { run_id: run };
      }
      case 'devices': return SerialPort.list();
      case 'terminal_list': return this.store.all(`SELECT id FROM terminals ${p.workspace_id ? 'WHERE workspace_id=?' : ''} ORDER BY rowid`, ...(p.workspace_id ? [p.workspace_id] : [])).map(t => this.store.terminal(t.id));
      case 'terminal_create': return this.create(p);
      case 'terminal_connect': return this.connect(required(p.id, 'id'));
      case 'terminal_close': await this.close(required(p.id, 'id')); return this.store.terminal(p.id);
      case 'terminal_update': {
        this.store.terminal(p.id);
        if (p.name !== undefined) this.store.run('UPDATE terminals SET name=? WHERE id=?', required(p.name, '名称', 80), p.id);
        if (p.model_write !== undefined) {
          if (typeof p.model_write !== 'boolean') throw new HttpError(400, 'model_write 必须是布尔值');
          this.store.run('UPDATE terminals SET model_write=? WHERE id=?', Number(p.model_write), p.id);
          if (!p.model_write) { const live = this.live.get(p.id); if (live) live.generation++; }
        }
        return this.store.terminal(p.id);
      }
      case 'terminal_sessions': this.store.terminal(p.id); return this.store.all('SELECT * FROM sessions WHERE terminal_id=? ORDER BY started DESC', p.id);
      case 'terminal_read': return this.store.read(p);
      case 'terminal_search': return this.store.search(p);
      case 'snapshot_create': return this.store.snapshot(p);
      case 'snapshot_get': return this.store.getSnapshot(p.id);
      case 'terminal_resize': {
        const l = this.live.get(p.id); l?.pty?.resize(integer(p.cols, 120, 20, 500), integer(p.rows, 32, 5, 200)); return { ok: true };
      }
      case 'terminal_send': return this.send(p);
      case 'terminal_wait': return this.wait(p);
      case 'operation_status': {
        const op = this.store.get('SELECT * FROM operations WHERE id=?', required(p.operation_id, 'operation_id'));
        if (!op) throw new HttpError(404, '操作不存在'); return op;
      }
      case 'operation_list': return this.store.all('SELECT * FROM operations WHERE terminal_id=? ORDER BY created DESC LIMIT 50', p.id);
      default: throw new HttpError(404, '未知终端服务方法');
    }
  }
  async create(p: any) {
    const w = this.store.workspace(required(p.workspace_id, 'workspace_id'));
    const name = required(p.name, '终端名称', 80);
    if (!['shell', 'ssh', 'serial'].includes(p.kind)) throw new HttpError(400, '终端类型无效');
    const config: any = {};
    if (p.kind === 'serial') {
      config.path = realpathSync(required(p.path, '串口路径'));
      if (!statSync(config.path).isCharacterDevice()) throw new HttpError(400, '串口必须是字符设备');
      config.baudRate = integer(p.baudRate, 115200, 50, 4000000);
    } else {
      config.cwd = realpathSync(p.cwd || w.cwd);
      if (!statSync(config.cwd).isDirectory()) throw new HttpError(400, '工作目录无效');
      if (p.kind === 'ssh') {
        config.host = required(p.host, 'SSH 目标', 255);
        if (!/^[a-zA-Z0-9_@.:[\]-]+$/.test(config.host) || config.host.startsWith('-')) throw new HttpError(400, 'SSH 目标只能是主机名、IP 或配置别名');
        config.port = integer(p.port, 22, 1, 65535);
        if (p.sshConfig) {
          config.sshConfig = realpathSync(required(p.sshConfig, 'SSH 配置文件'));
          if (!statSync(config.sshConfig).isFile()) throw new HttpError(400, 'SSH 配置文件无效');
        }
      }
    }
    const id = uid();
    this.store.run('INSERT INTO terminals(id,workspace_id,name,kind,config,state) VALUES(?,?,?,?,?,?)', id, w.id, name, p.kind, JSON.stringify(config), 'disconnected');
    await this.connect(id); return this.store.terminal(id);
  }
  async connect(id: string) {
    if (this.fatal) throw new HttpError(503, '持久化故障，请修复磁盘后重启采集服务');
    const t = this.store.terminal(id);
    if (this.live.has(id)) throw new HttpError(409, '终端已经连接或正在连接');
    if (t.kind === 'serial') {
      for (const other of this.live.keys()) if (this.store.terminal(other).config.path === t.config.path) throw new HttpError(409, '该串口已有采集连接');
    }
    const sid = this.store.begin(id);
    const live: Live = { sid, closing: false, queue: Promise.resolve(), generation: 0, queued: 0 };
    this.live.set(id, live);
    const append = (b: Buffer | string) => {
      if (live.closing) return;
      try { this.store.append(sid, Buffer.isBuffer(b) ? b : Buffer.from(b)); }
      catch (e) {
        this.fatal = `日志持久化失败：${String(e)}；采集已停止，可能缺失数据`;
        console.error(this.fatal);
        for (const key of this.live.keys()) void this.close(key, this.fatal, true).catch(console.error);
      }
    };
    try {
      if (t.kind === 'serial') {
        const port = new SerialPort({ path: t.config.path, baudRate: t.config.baudRate, autoOpen: false, lock: true, highWaterMark: 16384 });
        live.serial = port;
        port.on('data', append);
        port.on('error', e => { void this.close(id, `串口错误：${e.message}`, true).catch(console.error); });
        port.on('close', () => this.finish(id, live, '串口连接断开'));
        await new Promise<void>((resolve, reject) => port.open(e => e ? reject(e) : resolve()));
      } else {
        const command = t.kind === 'ssh' ? '/usr/bin/ssh' : '/bin/bash';
        const args = t.kind === 'ssh' ? ['-tt', ...(t.config.sshConfig ? ['-F', t.config.sshConfig] : []), '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', ...(t.config.port === 22 ? [] : ['-p', String(t.config.port)]), '--', t.config.host] : ['--login'];
        live.pty = ptySpawn(command, args, { name: 'xterm-256color', cols: 120, rows: 32, cwd: t.config.cwd, env: { ...process.env, TERM: 'xterm-256color' }, encoding: null });
        live.pty.onData(append);
        live.pty.onExit(e => this.finish(id, live, `进程退出：exit=${e.exitCode}, signal=${e.signal ?? 0}`));
      }
      if (!live.closing) this.store.run("UPDATE terminals SET state='connected',error=NULL WHERE id=?", id);
    } catch (e) { this.finish(id, live, String(e), true); }
    return this.store.terminal(id);
  }
  finish(id: string, l: Live, reason: string, error = false) {
    if (l.closing) return;
    l.closing = true;
    this.live.delete(id);
    try { this.store.finish(id, l.sid, reason, error); } catch (e) { this.fatal = String(e); console.error(e); }
  }
  async close(id: string, reason = '用户关闭连接', error = false) {
    this.store.terminal(id);
    const l = this.live.get(id); if (!l) return;
    this.finish(id, l, reason, error);
    if (l.serial?.isOpen) await new Promise<void>(resolve => l.serial!.close(() => resolve()));
    if (l.pty) { try { l.pty.kill('SIGTERM'); } catch {} const p = l.pty; const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 1000); timer.unref(); }
  }
  async send(p: any) {
    const id = required(p.id, 'id'); const opid = required(p.operation_id, 'operation_id', 128);
    if (typeof p.data !== 'string' || !p.data.length || Buffer.byteLength(p.data) > 65536) throw new HttpError(400, '输入必须为 1–65536 字节的文本');
    const data = p.data;
    const actor = p.actor === 'model' ? 'model' : 'human';
    const existing = this.store.get('SELECT * FROM operations WHERE id=?', opid);
    if (existing) {
      if (existing.terminal_id !== id || existing.data !== data || existing.actor !== actor) throw new HttpError(409, 'operation_id 已用于另一请求');
      return { ...existing, duplicate: true };
    }
    const t = this.store.terminal(id); const l = this.live.get(id);
    if (!l || l.closing || t.state !== 'connected') throw new HttpError(409, '终端未连接');
    if (actor === 'model' && !t.model_write) throw new HttpError(403, '此终端由人工控制；请在界面开启允许模型输入');
    if (l.queued >= 128) throw new HttpError(429, '终端输入队列已满，请等待已有操作完成');
    const generation = l.generation;
    const stamp = now();
    this.store.run('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?)', opid, id, l.sid, actor, data, 'queued', this.store.source(id).session.last_seq, stamp, stamp, null);
    l.queued++;
    l.queue = l.queue.catch(() => {}).then(async () => {
      if (l.closing || (actor === 'model' && (generation !== l.generation || !this.store.terminal(id).model_write))) {
        this.store.run("UPDATE operations SET state='cancelled',updated=?,error='终端关闭或人工接管，未发送' WHERE id=?", now(), opid); return;
      }
      // Boundary is captured immediately before writing, not at enqueue time.
      this.store.run("UPDATE operations SET state='writing',before_cursor=?,updated=? WHERE id=?", this.store.source(id, l.sid).session.last_seq, now(), opid);
      try {
        if (l.serial) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('串口发送/排空超过 5 秒，发送结果未知')), 5000);
            l.serial!.write(data, err => {
              if (err) { clearTimeout(timer); reject(err); return; }
              l.serial!.drain(err2 => { clearTimeout(timer); err2 ? reject(err2) : resolve(); });
            });
          });
        } else l.pty!.write(data);
        this.store.run("UPDATE operations SET state='sent',updated=? WHERE id=?", now(), opid);
      } catch (e) {
        this.store.run("UPDATE operations SET state='unknown',updated=?,error=? WHERE id=?", now(), String(e), opid);
        await this.close(id, '写入结果未知，请检查连接后手动重连', true);
      }
    }).finally(() => { l.queued--; });
    // Finite sends; duplicate requests inspect the same durable operation.
    await l.queue;
    return { ...this.store.get('SELECT * FROM operations WHERE id=?', opid), note: 'sent 仅表示已交给连接，不代表设备执行成功；用 before_cursor 之后的日志验证' };
  }
  async wait(p: any) {
    const { session: s } = this.store.source(required(p.id, 'id'), required(p.session_id, 'session_id'));
    const pattern = required(p.pattern, 'pattern', 512);
    let cursor = integer(p.after_cursor, s.last_seq, 0, Number.MAX_SAFE_INTEGER);
    const deadline = Date.now() + integer(p.timeout_ms, 10000, 0, 30000);
    let tail = '';
    for (;;) {
      const r = this.store.read({ ...p, after_cursor: cursor, max_bytes: 65536 });
      if (r.gaps.length) return { status: 'gap', next_cursor: r.next_cursor, gaps: r.gaps };
      const text = tail + r.text; const index = text.indexOf(pattern);
      if (index >= 0) return { status: 'matched', session_id: s.id, next_cursor: r.next_cursor, text: text.slice(Math.max(0, index - 256), index + pattern.length + 256) };
      tail = pattern.length > 1 ? text.slice(-(pattern.length - 1)) : ''; cursor = r.next_cursor;
      if (r.disconnected && !r.has_more) return { status: 'disconnected', next_cursor: cursor, reason: r.disconnect_reason };
      if (Date.now() >= deadline) return { status: 'timeout', next_cursor: cursor };
      await new Promise(resolve => setTimeout(resolve, r.has_more ? 0 : 100));
    }
  }
}

async function main() {
  if (existsSync(socketPath)) {
    try { await terminalCall('health', {}, 1000); throw new Error('已有采集服务正在运行'); }
    catch (e: any) { if (e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT') throw e; unlinkSync(socketPath); }
  }
  const service = new TerminalService(new Store(dataDir));
  if (!service.store.get('SELECT id FROM workspaces LIMIT 1')) await service.dispatch('workspace_create', { name: '当前项目', cwd: root });
  const server = http.createServer(async (req, res) => {
    try { const p = await body(req); json(res, await service.dispatch(p.method, p.params)); } catch (e) { fail(res, e); }
  });
  server.listen(socketPath, () => { chmodSync(socketPath, 0o600); console.log('terminal-service ready'); });
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    const queues = [...service.live.values()].map(l => l.queue);
    await Promise.all([...service.live.keys()].map(id => service.close(id, '后台停止')));
    await Promise.allSettled(queues);
    server.close(); service.store.close(); try { unlinkSync(socketPath); } catch {} process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (process.argv[1]?.endsWith('/terminal-service.js')) main().catch(e => { console.error(e); process.exit(1); });
