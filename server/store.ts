import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, writeSync, readSync, fsyncSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import { uid, now } from './config.js';
import { HttpError, integer, required } from './http.js';

export class Store {
  db: DatabaseSync;
  writers = new Map<string, { fd: number; part: number; offset: number; decoder: StringDecoder }>();
  constructor(public dir: string, public rotateBytes = 16 * 1024 * 1024) {
    mkdirSync(join(dir, 'raw'), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'terminal.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, run_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terminals(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, session_id TEXT, state TEXT NOT NULL, model_write INTEGER DEFAULT 0, error TEXT, UNIQUE(workspace_id,name));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, started TEXT NOT NULL, ended TEXT, reason TEXT, last_seq INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS logs(session_id TEXT NOT NULL, seq INTEGER NOT NULL, received TEXT NOT NULL, run_id TEXT NOT NULL, part INTEGER NOT NULL, offset INTEGER NOT NULL, length INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, session_id TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, before_cursor INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, terminal_id TEXT NOT NULL, session_id TEXT NOT NULL, start_seq INTEGER NOT NULL, end_seq INTEGER NOT NULL, created TEXT NOT NULL, text TEXT NOT NULL, run_ids TEXT NOT NULL, selection TEXT);
      CREATE INDEX IF NOT EXISTS operations_terminal ON operations(terminal_id, created);
    `);
  }
  all(sql: string, ...p: any[]): any[] { return this.db.prepare(sql).all(...p); }
  get(sql: string, ...p: any[]): any { return this.db.prepare(sql).get(...p); }
  run(sql: string, ...p: any[]) { return this.db.prepare(sql).run(...p); }
  workspace(id: string) {
    const w = this.get('SELECT * FROM workspaces WHERE id=?', id);
    if (!w) throw new HttpError(404, '项目不存在'); return w;
  }
  terminal(id: string) {
    const t = this.get('SELECT * FROM terminals WHERE id=?', id);
    if (!t) throw new HttpError(404, '终端不存在'); return { ...t, config: JSON.parse(t.config), model_write: !!t.model_write };
  }
  source(id: string, session?: string) {
    const t = this.terminal(id);
    const s = this.get('SELECT * FROM sessions WHERE id=? AND terminal_id=?', session || t.session_id || '', id);
    if (!s) throw new HttpError(404, '终端会话不存在');
    return { terminal: t, session: s };
  }
  recover() {
    const stamp = now();
    this.run("UPDATE sessions SET ended=?, reason='采集进程非正常退出，末尾可能缺失；需要手动重连' WHERE ended IS NULL", stamp);
    this.run("UPDATE terminals SET state='disconnected', error='采集服务已重启；断开期间可能缺失日志' WHERE state IN ('connected','connecting')");
    this.run("UPDATE operations SET state='unknown', error='发送期间进程退出，结果未知；禁止自动重试', updated=? WHERE state='writing'", stamp);
    this.run("UPDATE operations SET state='cancelled', error='发送前进程退出', updated=? WHERE state='queued'", stamp);
  }
  begin(id: string) {
    const sid = uid();
    this.run('INSERT INTO sessions(id,terminal_id,started) VALUES(?,?,?)', sid, id, now());
    this.run("UPDATE terminals SET session_id=?,state='connecting',error=NULL WHERE id=?", sid, id);
    return sid;
  }
  append(sid: string, input: Buffer) {
    const s = this.get('SELECT * FROM sessions WHERE id=?', sid);
    if (!s || s.ended) throw new Error('会话已经关闭');
    const t = this.terminal(s.terminal_id); const w = this.workspace(t.workspace_id);
    let writer = this.writers.get(sid);
    if (!writer) {
      writer = { fd: openSync(this.rawPath(sid, 0), 'ax', 0o600), part: 0, offset: 0, decoder: new StringDecoder('utf8') };
      this.writers.set(sid, writer);
    }
    // Bound each record so consumers always make progress at the minimum read size.
    for (let pos = 0; pos < input.length; pos += 4096) {
      const chunk = input.subarray(pos, pos + 4096);
      if (writer.offset && writer.offset + chunk.length > this.rotateBytes) {
        fsyncSync(writer.fd); closeSync(writer.fd); writer.part++; writer.offset = 0;
        writer.fd = openSync(this.rawPath(sid, writer.part), 'ax', 0o600);
      }
      const offset = writer.offset;
      let written = 0;
      while (written < chunk.length) written += writeSync(writer.fd, chunk, written, chunk.length - written);
      // Persist bytes before publishing the index. Crash-orphaned tails remain in raw files.
      fsyncSync(writer.fd);
      writer.offset += chunk.length;
      const text = writer.decoder.write(chunk);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const seq = this.get('SELECT last_seq FROM sessions WHERE id=?', sid).last_seq + 1;
        this.run('INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)', sid, seq, now(), w.run_id, writer.part, offset, chunk.length, text);
        this.run('UPDATE sessions SET last_seq=? WHERE id=?', seq, sid);
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  finish(id: string, sid: string, reason: string, error = false) {
    const writer = this.writers.get(sid);
    if (writer) { try { fsyncSync(writer.fd); } finally { closeSync(writer.fd); this.writers.delete(sid); } }
    this.run('UPDATE sessions SET ended=?, reason=? WHERE id=? AND ended IS NULL', now(), reason, sid);
    this.run('UPDATE terminals SET state=?,error=? WHERE id=? AND session_id=?', error ? 'error' : 'disconnected', reason, id, sid);
  }
  rawPath(sid: string, part: number) { return join(this.dir, 'raw', `${sid}.${part}.bin`); }
  read(p: any) {
    const { terminal: t, session: s } = this.source(required(p.id, 'id'), p.session_id);
    const cursor = integer(p.after_cursor, 0, 0, Number.MAX_SAFE_INTEGER);
    const max = integer(p.max_bytes, 65536, 4096, 262144);
    const end = integer(p.end_cursor, s.last_seq, 0, Number.MAX_SAFE_INTEGER);
    const rows = this.all('SELECT * FROM logs WHERE session_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 512', s.id, cursor, end);
    const records: any[] = []; const gaps: any[] = []; let bytes = 0; let next = cursor;
    for (const row of rows) {
      if (bytes + row.length > max) break;
      const path = this.rawPath(s.id, row.part); let raw: Buffer | undefined;
      try {
        const fd = openSync(path, 'r');
        try { raw = Buffer.alloc(row.length); if (readSync(fd, raw, 0, row.length, row.offset) !== row.length) throw new Error('原始文件尾部不完整'); }
        finally { closeSync(fd); }
      } catch (e) { gaps.push({ from: row.seq, to: row.seq, reason: String(e) }); raw = undefined; }
      if (row.seq !== next + 1) gaps.push({ from: next + 1, to: row.seq - 1, reason: '索引缺口' });
      records.push({ ...row, raw_base64: raw?.toString('base64') ?? null });
      bytes += row.length; next = row.seq;
    }
    if (cursor > s.last_seq) gaps.push({ reason: '游标超过会话末尾，请检查 session_id' });
    return { workspace_id: t.workspace_id, terminal_id: t.id, terminal_name: t.name, session_id: s.id,
      records, text: records.map(r => r.text).join(''), next_cursor: next,
      has_more: next < Math.min(end, s.last_seq), gaps, disconnected: !!s.ended, disconnect_reason: s.reason,
      last_cursor: s.last_seq, text_view: 'UTF-8 流解码；控制字符保留，不代表全屏终端屏幕语义' };
  }
  search(p: any) {
    const { terminal: t, session: s } = this.source(required(p.id, 'id'), p.session_id);
    const pattern = required(p.pattern, 'pattern', 512);
    let cursor = integer(p.after_cursor ?? p.range?.start, 0, 0, Number.MAX_SAFE_INTEGER);
    const end = integer(p.range?.end, s.last_seq, cursor, Number.MAX_SAFE_INTEGER);
    // Include a bounded prefix so literal matches spanning packets are found on page boundaries.
    const prefix = this.all('SELECT seq,text FROM logs WHERE session_id=? AND seq<=? ORDER BY seq DESC LIMIT 512', s.id, cursor).reverse();
    let window: { seq: number; text: string }[] = prefix;
    const matches: any[] = []; let scanned = 0;
    while (cursor < Math.min(end, s.last_seq) && scanned < 4096 && matches.length < 50) {
      const rows = this.all('SELECT seq,text,received,run_id FROM logs WHERE session_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 128', s.id, cursor, end);
      if (!rows.length) break;
      for (const row of rows) {
        const old = window.map(r => r.text).join('');
        const combined = old + row.text; let index = combined.indexOf(pattern);
        while (index >= 0) {
          if (index + pattern.length > old.length) {
            let offset = 0; let start = row.seq;
            for (const r of window) { if (offset + r.text.length > index) { start = r.seq; break; } offset += r.text.length; }
            matches.push({ start_seq: start, end_seq: row.seq, received: row.received, run_id: row.run_id,
              text: stripVTControlCharacters(combined.slice(Math.max(0, index - 120), index + pattern.length + 240)) });
            break; // One hit per ending record; paging never drops later records in a large packet.
          }
          index = combined.indexOf(pattern, index + Math.max(1, pattern.length));
        }
        window.push({ seq: row.seq, text: row.text });
        while (window.length > 1 && window.slice(1).reduce((n, r) => n + r.text.length, 0) >= pattern.length) window.shift();
        if (window.length > 512) window = window.slice(-512);
        cursor = row.seq; scanned++; if (matches.length >= 50 || scanned >= 4096) break;
      }
    }
    return { terminal_id: t.id, session_id: s.id, matches, next_cursor: cursor, has_more: cursor < Math.min(end, s.last_seq), literal: true, match_unit: 'at most one match per ending record' };
  }
  snapshot(p: any) {
    const { terminal: t, session: s } = this.source(required(p.id, 'id'), p.session_id);
    const start = integer(p.start_seq, Math.max(1, s.last_seq - 15), 1, Math.max(1, s.last_seq));
    const end = integer(p.end_seq, s.last_seq, start, s.last_seq);
    const records: any[] = []; let cursor = start - 1; let bytes = 0;
    while (cursor < end) {
      const page = this.read({ id: t.id, session_id: s.id, after_cursor: cursor, end_cursor: end, max_bytes: 262144 });
      if (page.next_cursor === cursor) throw new HttpError(400, '引用范围存在索引缺口');
      records.push(...page.records); bytes += page.records.reduce((n, r) => n + r.length, 0); cursor = page.next_cursor;
      if (bytes > 262144 || records.length > 8192) throw new HttpError(400, '引用超过 256 KiB 或 8192 条记录，请缩小范围');
    }
    const snapshot = { id: uid(), workspace_id: t.workspace_id, terminal_id: t.id, session_id: s.id, start_seq: start, end_seq: end,
      created: now(), text: records.map(r => r.text).join(''), run_ids: [...new Set(records.map(r => r.run_id))], selection: p.selection ? required(p.selection, 'selection', 65536) : null };
    if (snapshot.selection && !stripVTControlCharacters(snapshot.text).includes(snapshot.selection)) {
      throw new HttpError(400, '选中文本与原始日志不一致；请在日志视图按记录引用');
    }
    this.run('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?)', snapshot.id, t.workspace_id, t.id, s.id, start, end, snapshot.created, snapshot.text, JSON.stringify(snapshot.run_ids), snapshot.selection);
    return snapshot;
  }
  getSnapshot(id: string) {
    const s = this.get('SELECT * FROM snapshots WHERE id=?', id);
    if (!s) throw new HttpError(404, '引用不存在');
    const parts = this.all('SELECT DISTINCT part FROM logs WHERE session_id=? AND seq BETWEEN ? AND ?', s.session_id, s.start_seq, s.end_seq);
    return { ...s, run_ids: JSON.parse(s.run_ids), raw_available: parts.length > 0 && parts.every(p => existsSync(this.rawPath(s.session_id, p.part))) };
  }
  close() { for (const w of this.writers.values()) closeSync(w.fd); this.writers.clear(); this.db.close(); }
}
