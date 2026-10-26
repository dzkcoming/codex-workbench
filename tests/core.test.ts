import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Store } from '../server/store.js';
import { TerminalService } from '../server/terminal-service.js';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) { const deadline = Date.now() + ms; while (!fn()) { if (Date.now() > deadline) throw new Error('condition timed out'); await delay(20); } }
function fixture(rotate = 8192) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-core-'));
  const store = new Store(dir, rotate);
  store.run('INSERT INTO workspaces VALUES(?,?,?,?)', 'w', 'test', dir, 'run1');
  store.run('INSERT INTO terminals(id,workspace_id,name,kind,config,state) VALUES(?,?,?,?,?,?)', 't', 'w', 'uart', 'serial', '{}', 'disconnected');
  return { store, dir, clean: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('raw bytes survive UTF-8 splits, ANSI, no newline, rotation, and cursor paging', () => {
  const f = fixture();
  try {
    const sid = f.store.begin('t');
    const original = Buffer.from('\x1b[31m连续中文\x1b[0m' + 'no-newline'.repeat(3000));
    for (let i = 0; i < original.length; i += 47) f.store.append(sid, original.subarray(i, i + 47));
    let cursor = 0; const buffers: Buffer[] = []; let text = '';
    for (;;) {
      const r = f.store.read({ id: 't', session_id: sid, after_cursor: cursor, max_bytes: 4096 });
      assert.equal(r.gaps.length, 0); assert.ok(r.next_cursor > cursor);
      buffers.push(...r.records.map(r => Buffer.from(r.raw_base64, 'base64'))); text += r.text; cursor = r.next_cursor;
      if (!r.has_more) break;
    }
    assert.deepEqual(Buffer.concat(buffers), original); assert.equal(text, original.toString());
    assert.ok(readdirSync(join(f.dir, 'raw')).length >= 4);
    assert.equal(f.store.read({ id: 't', session_id: sid, after_cursor: cursor }).text, '');
  } finally { f.clean(); }
});
test('search crosses packet boundaries and honors bounded pagination; snapshot survives missing raw file', () => {
  const f = fixture();
  try {
    const sid = f.store.begin('t');
    for (const char of 'x'.repeat(4090) + 'firmware-build-FAIL' + 'y'.repeat(20)) f.store.append(sid, Buffer.from(char));
    const first = f.store.search({ id: 't', session_id: sid, pattern: 'firmware-build-FAIL' });
    assert.equal(first.matches.length, 0); assert.equal(first.has_more, true);
    const second = f.store.search({ id: 't', session_id: sid, pattern: 'firmware-build-FAIL', after_cursor: first.next_cursor });
    assert.equal(second.matches.length, 1); assert.equal(second.matches[0].start_seq, 4091);
    const paged = f.store.snapshot({ id: 't', session_id: sid, start_seq: 1, end_seq: 4109 });
    assert.equal(paged.text.length, 4109); // Snapshot spans more than one 512-record read page.
    const snap = f.store.snapshot({ id: 't', session_id: sid, start_seq: 4091, end_seq: 4109 });
    assert.ok(snap.text.includes('firmware-build-FAIL'));
    unlinkSync(f.store.rawPath(sid, 0));
    assert.equal(f.store.getSnapshot(snap.id).raw_available, false);
    assert.equal(f.store.getSnapshot(snap.id).text, snap.text);
    assert.ok(f.store.read({ id: 't', session_id: sid }).gaps.length);
  } finally { f.clean(); }
});
test('run boundaries, renamed terminals, reconnect sessions, and crash recovery preserve provenance', () => {
  const f = fixture();
  try {
    const sid = f.store.begin('t'); f.store.append(sid, Buffer.from('before'));
    f.store.run('UPDATE workspaces SET run_id=? WHERE id=?', 'run2', 'w');
    f.store.run('UPDATE terminals SET name=? WHERE id=?', 'renamed', 't'); f.store.append(sid, Buffer.from('after'));
    f.store.run('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?)', 'op', 't', sid, 'model', 'reset\r', 'writing', 1, 'now', 'now', null);
    f.store.finish('t', sid, 'test close'); const next = f.store.begin('t'); f.store.append(next, Buffer.from('new'));
    f.store.recover();
    const logs = f.store.read({ id: 't', session_id: sid });
    assert.deepEqual(logs.records.map(r => r.run_id), ['run1', 'run2']); assert.equal(logs.terminal_name, 'renamed');
    assert.equal(f.store.get('SELECT state FROM operations WHERE id=?', 'op').state, 'unknown');
    assert.ok(f.store.source('t', next).session.reason.includes('可能缺失'));
  } finally { f.clean(); }
});
test('PTY shell sends are durable, duplicate IDs cannot execute twice, and model takeover is enforced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-pty-')); const store = new Store(dir); const service = new TerminalService(store);
  try {
    const w = await service.dispatch('workspace_create', { name: 'test', cwd: dir });
    const t = await service.dispatch('terminal_create', { name: 'local', kind: 'shell', workspace_id: w.id });
    assert.equal(t.state, 'connected');
    await assert.rejects(service.send({ id: t.id, data: 'pwd\r', operation_id: 'denied', actor: 'model' }), /人工控制/);
    const request = { id: t.id, data: "printf '\\n%s%s\\n' 'WB_' 'PASS'\r", operation_id: 'once' };
    const op = await service.send(request); assert.equal(op.state, 'sent');
    const duplicate = await service.send(request); assert.equal(duplicate.duplicate, true);
    await assert.rejects(service.send({ ...request, data: 'different' }), /另一请求/);
    const result = await service.wait({ id: t.id, session_id: t.session_id, after_cursor: op.before_cursor, pattern: 'WB_PASS', timeout_ms: 5000 });
    assert.equal(result.status, 'matched');
    const boundary = store.source(t.id).session.last_seq;
    assert.equal((await service.wait({ id: t.id, session_id: t.session_id, after_cursor: boundary, pattern: 'WB_PASS', timeout_ms: 100 })).status, 'timeout');
    assert.equal((await service.send({ id: t.id, data: '\r', operation_id: 'enter' })).state, 'sent');
    await service.dispatch('terminal_update', { id: t.id, model_write: true });
    await service.send({ id: t.id, data: 'pwd\r', operation_id: 'model-allowed', actor: 'model' });
    const queued = service.send({ id: t.id, data: 'pwd\r', operation_id: 'takeover-queued', actor: 'model' });
    await service.dispatch('terminal_update', { id: t.id, model_write: false });
    assert.equal((await queued).state, 'cancelled');
    await assert.rejects(service.send({ id: t.id, data: 'pwd\r', operation_id: 'model-blocked', actor: 'model' }), /人工控制/);
    await service.close(t.id);
    assert.equal((await service.wait({ id: t.id, session_id: t.session_id, after_cursor: 99999, pattern: 'nothing', timeout_ms: 100 })).status, 'gap');
    assert.equal((await service.wait({ id: t.id, session_id: t.session_id, after_cursor: store.source(t.id).session.last_seq, pattern: 'nothing', timeout_ms: 100 })).status, 'disconnected');
  } finally { await Promise.all([...service.live.keys()].map(id => service.close(id))); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('real SerialPort on pseudo-TTY: continuous capture, exclusive ownership, send, wait, disconnect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-serial-')); const store = new Store(dir, 8192); const service = new TerminalService(store);
  const fixture = spawn('python3', ['tests/serial-fixture.py'], { stdio: 'pipe' }); let device = ''; const received: Buffer[] = [];
  createInterface({ input: fixture.stdout }).on('line', line => { const p = JSON.parse(line); if (p.path) device = p.path; if (p.received) received.push(Buffer.from(p.received, 'base64')); });
  try {
    await until(() => !!device);
    const w = await service.dispatch('workspace_create', { name: 'serial', cwd: dir });
    const t = await service.create({ workspace_id: w.id, name: 'dut-uart', kind: 'serial', path: device, baudRate: 115200 });
    assert.equal(t.state, 'connected', t.error);
    await assert.rejects(service.create({ workspace_id: w.id, name: 'duplicate', kind: 'serial', path: device }), /已有采集连接/);
    const payload = Buffer.from('串口输出\r\n' + '0123456789'.repeat(4000));
    fixture.stdin.write(JSON.stringify({ write: payload.toString('base64') }) + '\n');
    await until(() => store.get('SELECT SUM(length) AS n FROM logs WHERE session_id=?', t.session_id).n === payload.length);
    const logs = store.read({ id: t.id, session_id: t.session_id });
    assert.deepEqual(Buffer.concat(logs.records.map(r => Buffer.from(r.raw_base64, 'base64'))), payload);
    const op = await service.send({ id: t.id, data: 'status\r', operation_id: 'serial-once' });
    await service.send({ id: t.id, data: 'status\r', operation_id: 'serial-once' });
    await until(() => Buffer.concat(received).includes('status\r'));
    assert.equal(Buffer.concat(received).toString(), 'status\r');
    const waiter = service.wait({ id: t.id, session_id: t.session_id, after_cursor: op.before_cursor, pattern: 'TEST_PASS', timeout_ms: 3000 });
    fixture.stdin.write(JSON.stringify({ write: Buffer.from('TEST_').toString('base64') }) + '\n'); await delay(50);
    fixture.stdin.write(JSON.stringify({ write: Buffer.from('PASS').toString('base64') }) + '\n');
    assert.equal((await waiter).status, 'matched');
    fixture.stdin.write('{"close":true}\n');
    await until(() => store.terminal(t.id).state !== 'connected');
    const end = store.source(t.id).session.last_seq;
    assert.equal((await service.wait({ id: t.id, session_id: t.session_id, after_cursor: end, pattern: 'FAIL', timeout_ms: 500 })).status, 'disconnected');
  } finally { fixture.kill(); await Promise.all([...service.live.keys()].map(id => service.close(id))); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('persistence failure is surfaced and stops capture instead of silently losing data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-fault-')); const store = new Store(dir); const service = new TerminalService(store);
  try {
    const w = await service.dispatch('workspace_create', { name: 'test', cwd: dir });
    const t = await service.create({ name: 'fault', kind: 'shell', workspace_id: w.id });
    store.append = () => { throw new Error('ENOSPC simulated'); };
    await service.send({ id: t.id, data: 'echo failure\r', operation_id: 'fault' });
    await until(() => !!service.fatal);
    assert.match(service.fatal!, /ENOSPC/); assert.equal((await service.dispatch('health')).ok, false);
    assert.equal(store.terminal(t.id).state, 'error');
  } finally { await Promise.all([...service.live.keys()].map(id => service.close(id))); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
