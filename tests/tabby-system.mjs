import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchTabby, openProfile, selectText, visibleText, measureEcho, until, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-system-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const report = [];
const pass = (name, details = {}) => { report.push({ name, ...details }); const { samples, ...summary } = details; console.log('PASS', name, JSON.stringify(summary)); };
const echoProgram = 'import sys,tty,os\nprint("BUILD_EVIDENCE=build-ok-4826",flush=True)\ntty.setraw(0)\nwhile True:\n b=os.read(0,4096)\n if not b: break\n os.write(1,b)';
const echoProfile = { type: 'local', name: 'latency', options: { command: '/usr/bin/python3', args: ['-u', '-c', echoProgram], cwd: workspace } };
let instance; let serial;
try {
  instance = await launchTabby(join(dir, 'baseline'), workspace, false);
  await openProfile(instance.page, 'baseline', echoProfile);
  const baseline = await measureEcho(instance.page, 'baseline');
  await instance.close(); instance = null;
  pass('原版 Tabby 输入基线', baseline);

  instance = await launchTabby(join(dir, 'plugin'), workspace, true);
  const page = instance.page;
  await openProfile(page, 'build', echoProfile);
  const enabled = await measureEcho(page, 'build');
  pass('插件启用后输入响应', enabled);

  const selected = await selectText(page, 'build', 'BUILD_EVIDENCE=build-ok-4826');
  assert.equal(selected, 'BUILD_EVIDENCE=build-ok-4826');
  // Exercise the same provider and click callback that Tabby's native context menu invokes.
  const first = await page.evaluate(async () => {
    const state = window.__test;
    const providers = state.injector.get(state.core.TabContextMenuItemProvider);
    const menu = providers.find(p => p instanceof state.plugin.ReferenceMenu);
    const items = await menu.getItems(state.tabs.build);
    const references = items.find(item => item.label === 'Codex 引用');
    const action = references.submenu.find(item => item.label === '创建选区引用并复制');
    if (!action.enabled) throw new Error('Selection action is disabled');
    action.click();
    return references.label;
  });
  assert.equal(first, 'Codex 引用');
  await until(() => existsSync(join(workspace, '.terminal-references')) && readdirSync(join(workspace, '.terminal-references')).some(x => x.startsWith('ref_')));
  await until(() => page.evaluate(() => window.__test.references.platform.readClipboard().includes('BUILD_EVIDENCE')));
  const clipboard = await page.evaluate(() => window.__test.references.platform.readClipboard());
  const buildID = clipboard.match(/ref_\d{8}T\d{9}Z_[a-f0-9]{16}/)[0];
  assert.match(clipboard, /build/); assert.match(clipboard, /固定快照文件/);
  const buildText = readFileSync(join(workspace, '.terminal-references', buildID, 'content.txt'), 'utf8');
  assert.equal(buildText, selected);
  const pids = await page.evaluate(() => ({ renderer: process.pid, worker: window.__test.references.bridge.child.pid }));
  assert.notEqual(pids.worker, pids.renderer);
  pass('真实选区、右键菜单动作、剪贴板和独立记录进程', { buildID, ...pids });

  serial = spawn('python3', ['tests/serial-fixture.py'], { stdio: 'pipe' }); let device;
  createInterface({ input: serial.stdout }).on('line', line => { const data = JSON.parse(line); if (data.path) device = data.path; });
  await until(() => device);
  await openProfile(page, 'dut-uart', { type: 'serial', name: 'dut-uart', options: { port: device, baudrate: 115200 } });
  serial.stdin.write(JSON.stringify({ write: Buffer.from('BOOT\r\nUART_EVIDENCE=voltage-low-7931\r\n').toString('base64') }) + '\n');
  await selectText(page, 'dut-uart', 'UART_EVIDENCE=voltage-low-7931');
  const uart = await page.evaluate(() => window.__test.references.createFromSelection(window.__test.tabs['dut-uart']));
  assert.equal(uart.source.kind, 'serial'); assert.equal(uart.source.name, 'dut-uart');
  assert.notEqual(uart.source.terminal_id, JSON.parse(readFileSync(join(workspace, '.terminal-references', buildID, 'metadata.json'))).source.terminal_id);
  for (let i = 0; i < 50; i++) serial.stdin.write(JSON.stringify({ write: Buffer.from('LATER_LOG_' + i + '\r\n').toString('base64') }) + '\n');
  assert.equal(readFileSync(join(workspace, '.terminal-references', uart.id, 'content.txt'), 'utf8'), 'UART_EVIDENCE=voltage-low-7931');
  pass('Tabby 原生串口驱动连接伪终端，跨终端来源与滚屏后引用保持一致', { uartID: uart.id });

  // The page uses a real Tabby settings tab and native Angular component, not a mock renderer.
  await page.evaluate(async () => {
    const state = window.__test;
    await state.app.openNewTabRaw({ type: require('tabby-settings').SettingsTabComponent, inputs: { activeTab: 'codex-references' } });
  });
  await page.getByRole('heading', { name: 'Codex 引用', exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText(uart.id, { exact: true }).waitFor();
  await page.screenshot({ path: join(dir, 'references.png') });
  await page.getByRole('button', { name: '复制引用', exact: true }).first().click();
  assert.match(await page.evaluate(() => window.__test.references.platform.readClipboard()), /UART_EVIDENCE/);
  pass('原生设置页展示与复制历史引用');

  // Sample typing while a second terminal streams output and the worker persists snapshots.
  const flood = setInterval(() => serial.stdin.write(JSON.stringify({ write: Buffer.from('LOG_STREAM\r\n'.repeat(300)).toString('base64') }) + '\n'), 40);
  const recording = page.evaluate(async () => {
    const state = window.__test;
    for (let i = 0; i < 10; i++) {
      await state.references.bridge.request(state.references.workspace, 'create', { text: 'BACKGROUND_DATA\n'.repeat(16000),
        source: { terminal_id: 'load-fixture', session_id: 'load-fixture', name: '负载测试', kind: 'fixture', captured_at: new Date().toISOString() } });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });
  let loaded;
  try { loaded = await measureEcho(page, 'build'); await recording; } finally { clearInterval(flood); }
  pass('串口输出与快照持久化并行时输入响应', loaded);
  const pluginErrors = instance.errors.filter(x => !x.includes('Bad atom'));
  assert.deepEqual(pluginErrors, []);
  await page.screenshot({ path: join(dir, 'terminal.png') });
  await instance.close(); instance = null; serial.kill(); serial = null;
  assert.equal(readFileSync(join(workspace, '.terminal-references', buildID, 'content.txt'), 'utf8'), selected);
  pass('Tabby 退出后固定引用仍可读取');
  writeFileSync(join(dir, 'references.json'), JSON.stringify({ workspace, buildID, uartID: uart.id }, null, 2));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  writeFileSync(join(dir, 'failure.txt'), String(error.stack));
  if (instance) await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  throw error;
} finally { if (serial) serial.kill(); if (instance) await instance.close(); }
