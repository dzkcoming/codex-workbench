// Assessment only: runs an isolated workbench; does not touch managed user terminals.
// Measures input -> output available to browser JS, NOT pixels on the screen.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import net from 'node:net';
import { spawn as ptySpawn } from 'node-pty';
import { chromium } from '@playwright/test';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(10); }
  throw new Error('Measurement timed out');
}
function summary(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const percentile = p => Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 100) / 100;
  return { samples: samples.length, min_ms: percentile(1 / samples.length), p50_ms: percentile(.5), p95_ms: percentile(.95), max_ms: percentile(1) };
}
const root = process.cwd(); mkdirSync('test-results', { recursive: true });
const dir = mkdtempSync(resolve('test-results/latency-'));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const url = `http://127.0.0.1:${port}`;
let supervisor, browser, direct;
let cookie = '';
async function api(path, data) {
  const response = await fetch(url + path, { ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }), headers: { 'Content-Type': 'application/json', Cookie: cookie } });
  const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result;
}
const rpc = (method, params = {}) => api('/api/terminal', { method, params });
try {
  const log = openSync(join(dir, 'server.log'), 'a');
  supervisor = spawn(process.execPath, ['dist/server/supervisor.js', '--allow-standalone', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { ...process.env, WORKBENCH_ROOT: root, WORKBENCH_DATA: dir }, stdio: ['ignore', log, log],
  });
  await until(async () => { try { return (await fetch(url + '/api/health')).ok; } catch { return false; } });
  const token = readFileSync(join(dir, 'access-token'), 'utf8');
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const w = await rpc('workspace_create', { name: '交互延迟评估', cwd: dir });
  const terminal = await rpc('terminal_create', { workspace_id: w.id, name: 'echo-probe', kind: 'shell' });
  await rpc('terminal_send', { id: terminal.id, data: "stty raw -echo; printf '\\nPROBE_READY\\n'; exec cat\r", operation_id: 'start-probe' });
  await delay(500);
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.__trial = null;
    document.addEventListener('keydown', event => {
      const trial = window.__trial;
      if (trial && event.key === trial.char && trial.keydown === undefined) trial.keydown = performance.now();
    }, true);
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      let request;
      try { if (String(input) === '/api/terminal') request = JSON.parse(init?.body || '{}'); } catch {}
      const trial = window.__trial;
      if (trial && request?.method === 'terminal_send' && request.params.data === trial.char) trial.sendStart = performance.now();
      const response = await original(input, init);
      if (trial && request?.method === 'terminal_send' && request.params.data === trial.char) trial.sendAck = performance.now();
      if (trial && request?.method === 'terminal_read') {
        response.clone().json().then(data => {
          if (trial.keydown !== undefined && data.text?.includes(trial.char) && trial.output === undefined) trial.output = performance.now();
        }).catch(() => {});
      }
      return response;
    };
  });
  await page.goto(url + '/#token=' + token);
  await page.getByLabel('当前项目').selectOption(w.id);
  await page.locator('.xterm-helper-textarea').focus(); await delay(700);
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await delay(25 + (i * 137) % 480); // Sample different polling phases reproducibly.
    const char = 'abcdefghijklmnopqrstuvwxyz'[i % 26];
    await page.evaluate(char => { window.__trial = { char }; }, char);
    await page.keyboard.press(char);
    const trial = await until(async () => { const t = await page.evaluate(() => window.__trial); return t?.output !== undefined ? t : false; });
    samples.push({ input_to_browser_output_ms: trial.output - trial.keydown, input_to_send_start_ms: trial.sendStart - trial.keydown, input_to_send_ack_ms: trial.sendAck - trial.keydown });
  }
  await browser.close(); browser = null; await rpc('terminal_close', { id: terminal.id });
  let buffer = '';
  direct = ptySpawn('/bin/bash', ['--noprofile', '--norc', '-c', "stty raw -echo; printf 'READY'; exec cat"], { encoding: 'utf8', name: 'xterm-256color', cols: 80, rows: 24, cwd: dir });
  direct.onData(s => { buffer += s; }); await until(() => buffer.includes('READY'));
  const rawSamples = [];
  for (let i = 0; i < 30; i++) {
    const char = String.fromCharCode(97 + i % 26);
    rawSamples.push(await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Direct PTY timed out')), 2000);
      const start = performance.now();
      const listener = direct.onData(s => { if (s.includes(char)) { clearTimeout(timer); listener.dispose(); resolve(performance.now() - start); } });
      direct.write(char);
    }));
  }
  const result = {
    measured_at: new Date().toISOString(),
    scope: 'Isolated local raw-mode cat, 30 single-key samples, no synthetic competing load, headless Chrome; browser measure stops at readable response JSON. Direct PTY excludes persistence, UI, and rendering. Not a native GUI terminal comparison or hardware keyboard-to-photon measurement.',
    current_browser_path: summary(samples.map(s => s.input_to_browser_output_ms)),
    current_send_ack: summary(samples.map(s => s.input_to_send_ack_ms)),
    direct_pty_transport_only: summary(rawSamples), samples,
  };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, samples: undefined, report: join(dir, 'report.json') }, null, 2));
} finally {
  if (direct) direct.kill(); if (browser) await browser.close();
  if (supervisor) { supervisor.kill('SIGTERM'); await delay(3000); if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL'); }
}
