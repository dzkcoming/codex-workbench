import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { launchTabby, openProfile, selectText, visibleText, measureEcho, until, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-panes-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const report = [];
const pass = (name, details = {}) => { report.push({ name, ...details }); console.log('PASS', name, JSON.stringify(details)); };
const inputText = async (page, name) => (await visibleText(page, name)).replace(/TICK=\d+|\s/g, '');
const fixture = name => ({ type: 'local', name, options: { command: '/usr/bin/python3', args: ['-u', '-c',
  `import os,tty,threading,time\nprint("SOURCE=${name}",flush=True)\ntty.setraw(0)\ndef ticks():\n i=0\n while True:\n  time.sleep(.4)\n  i+=1\n  os.write(1,("\\r\\nTICK=%d\\r\\n"%i).encode())\nthreading.Thread(target=ticks,daemon=True).start()\nwhile True:\n b=os.read(0,4096)\n if not b:break\n os.write(1,b)`], cwd: workspace } });
let instance, serial;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await page.evaluate(() => { const win = require('@electron/remote').getCurrentWindow(); win.unmaximize(); win.setSize(1200, 800); });
  await openProfile(page, 'left', fixture('left'));
  await page.evaluate(() => {
    const s = __test;
    s.layout = s.injector.get(s.plugin.PaneLayoutService);
    s.leftSession = s.tabs.left.session;
    s.leftFrontend = s.tabs.left.frontend;
    s.root = s.tabs.left.parent;
    s.topCount = s.app.tabs.length;
  });
  await page.evaluate(() => {
    const toolbar = __test.injector.get(__test.core.ToolbarButtonProvider).flatMap(p => p.provide());
    toolbar.find(b => b.title === '分屏内标签').click();
  });
  await page.locator('workbench-pane-tabs').waitFor();
  await page.waitForFunction(() => __test.tabs.left.parent instanceof __test.plugin.PaneTabsComponent && __test.tabs.left.parent.active === __test.tabs.left);
  assert.deepEqual(await page.evaluate(() => ({ session: __test.tabs.left.session === __test.leftSession,
    frontend: __test.tabs.left.frontend === __test.leftFrontend, topTabs: __test.app.tabs.length === __test.topCount })),
  { session: true, frontend: true, topTabs: true });
  pass('启用分屏标签保留原终端会话、渲染器和顶部标签');

  await page.evaluate(async () => { __test.left = __test.tabs.left.parent; __test.right = await __test.layout.split(__test.left, 'r'); });
  await page.waitForFunction(() => __test.right?.active?.session?.open);
  await page.evaluate(async profile => {
    const s = __test;
    s.tabs.right1 = await s.layout.openInPane(s.right, profile); s.tabs.right1.setCustomTitle('right1');
  }, fixture('right1'));
  await page.waitForFunction(() => __test.tabs.right1.session?.open);
  await page.evaluate(() => { __test.rightSession = __test.tabs.right1.session; });
  await page.evaluate(async profile => {
    const s = __test;
    s.tabs.right2 = await s.layout.openInPane(s.right, profile); s.tabs.right2.setCustomTitle('right2');
  }, fixture('right2'));
  await page.waitForFunction(() => __test.tabs.right2.session?.open);
  const panes = page.locator('workbench-pane-tabs');
  await panes.nth(1).getByRole('tab', { name: 'right1', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === __test.tabs.right1.frontend.xterm.textarea);
  await page.keyboard.type('ONLY_RIGHT_ONE');
  await until(async () => (await inputText(page, 'right1')).includes('ONLY_RIGHT_ONE'));
  assert.ok(!(await inputText(page, 'left')).includes('ONLY_RIGHT_ONE'));
  assert.ok(!(await inputText(page, 'right2')).includes('ONLY_RIGHT_ONE'));
  await panes.nth(1).getByRole('tab', { name: 'right2', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === __test.tabs.right2.frontend.xterm.textarea);
  await page.keyboard.type('ONLY_RIGHT_TWO');
  await until(async () => (await inputText(page, 'right2')).includes('ONLY_RIGHT_TWO'));
  assert.equal(await page.evaluate(() => __test.left.active === __test.tabs.left), true);
  const before = (await visibleText(page, 'right1')).match(/TICK=\d+/g)?.length ?? 0;
  await delay(900);
  assert.ok(((await visibleText(page, 'right1')).match(/TICK=\d+/g)?.length ?? 0) > before);
  assert.equal(await page.evaluate(() => __test.tabs.right1.session === __test.rightSession), true);
  pass('右侧标签独立切换、后台会话持续输出，输入不串到其他终端');

  // Click the moved terminal host: Tabby retains its old split focus listener after reparenting.
  await panes.nth(0).locator('.xterm-screen').click({ position: { x: 30, y: 30 } });
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.left && document.activeElement === __test.tabs.left.frontend.xterm.textarea);
  await page.keyboard.type('LEFT_AFTER_MOVE');
  await until(async () => (await inputText(page, 'left')).includes('LEFT_AFTER_MOVE'));
  const echo = await measureEcho(page, 'left', 20);
  pass('移动原终端后的鼠标焦点与键盘输入', { median: echo.median, p95: echo.p95, max: echo.max });

  await selectText(page, 'right2', 'SOURCE=right2');
  const reference = await page.evaluate(() => __test.references.createFromSelection(__test.references.activeTerminal()));
  assert.equal(reference.source.name, 'right2');
  assert.equal(readFileSync(join(workspace, '.terminal-references', reference.id, 'content.txt'), 'utf8'), 'SOURCE=right2');
  pass('引用快捷入口解析到当前分屏的当前标签', { reference: reference.id });

  await panes.nth(1).getByRole('button', { name: '在此分屏新建 Shell', exact: true }).click();
  await page.waitForFunction(() => __test.right.tabs.length === 4 && __test.right.active.session?.open);
  await page.evaluate(() => __test.right.select(__test.tabs.right2));
  await openProfile(page, 'outer', fixture('outer'));
  assert.equal(await page.evaluate(() => __test.app.tabs.length === __test.topCount + 1), true);
  await page.evaluate(() => __test.app.selectTab(__test.root));
  await page.waitForFunction(() => __test.right.active === __test.tabs.right2 && !!__test.tabs.right2.frontend.xterm.textarea.offsetParent);
  pass('分屏内加号新增终端，原有顶部标签独立切换并保留各分屏选择');

  await page.evaluate(async () => {
    __test.bottom = await __test.layout.split(__test.right, 'b');
  });
  await page.waitForFunction(() => __test.bottom?.active?.session?.open);
  await page.evaluate(() => __test.right.select(__test.tabs.right2));
  const geometry = await page.evaluate(() => [__test.left, __test.right, __test.bottom].map(x => __test.root.getPaneGeometry(x)));
  assert.equal(geometry[0].h, 100);
  assert.equal(geometry[1].h, 50);
  assert.equal(geometry[2].y, 50);
  await page.screenshot({ path: join(dir, 'pane-tabs.png') });
  pass('左右分屏后可继续上下分屏，每个区域有独立标签栏', { geometry });

  // Native recovery serializes every pane, all inner tabs, and the selected index.
  const token = await page.evaluate(() => __test.injector.get(__test.core.TabRecoveryService).getFullRecoveryToken(__test.root, { includeState: true }));
  writeFileSync(join(dir, 'layout-token.json'), JSON.stringify(token, null, 2));
  const extract = token => token.type === 'codex-workbench:pane-tabs' ? [token] : (token.children ?? []).flatMap(extract);
  const savedPanes = extract(token);
  assert.deepEqual(savedPanes.map(p => p.children.length), [1, 4, 1]);
  assert.equal(savedPanes[1].activeIndex, 2);
  // Without live PTY IDs recovery launches fresh sessions; test this separately from live originals.
  const fresh = JSON.parse(JSON.stringify(token), (key, value) => key === 'restoreFromPTYID' ? null : value);
  await page.evaluate(async token => {
    const s = __test;
    const params = await s.injector.get(s.core.TabRecoveryService).recoverTab(token);
    s.restored = s.app.openNewTabRaw(params);
  }, fresh);
  await page.waitForFunction(() => __test.restored?.getAllTabs().length === 3 && __test.restored.getAllTabs().every(p => p.tabs?.length && p.tabs.every(t => t.session?.open)));
  assert.deepEqual(await page.evaluate(() => __test.restored.getAllTabs().map(p => ({ count: p.tabs.length, active: p.tabs.indexOf(p.active) }))),
    [{ count: 1, active: 0 }, { count: 4, active: 2 }, { count: 1, active: 0 }]);
  pass('Tabby 原生恢复保留分屏结构、内部标签和选中项');

  await page.evaluate(() => __test.app.selectTab(__test.root));
  // Veto must preserve the session; closing a hidden tab must preserve its active sibling.
  await page.evaluate(async () => {
    const s = __test; const tab = s.tabs.right1;
    s.originalCanClose = tab.canClose; tab.canClose = async () => false;
    await s.right.closeTab(tab);
  });
  assert.equal(await page.evaluate(() => __test.right.tabs.includes(__test.tabs.right1)), true);
  await page.evaluate(async () => {
    const s = __test; s.tabs.right1.canClose = s.originalCanClose;
    // Fixture is a deliberately running Python process. Accept close without a modal in the test only.
    s.tabs.right1.canClose = async () => true;
    await s.right.closeTab(s.tabs.right1);
  });
  assert.equal(await page.evaluate(() => __test.right.active === __test.tabs.right2 && __test.tabs.right2.session.open && __test.tabs.left.session.open), true);
  await page.evaluate(async () => { const tab = __test.bottom.active; tab.canClose = async () => true; await __test.bottom.closeTab(tab); });
  await page.waitForFunction(() => __test.root.getAllTabs().length === 2);
  pass('关闭确认生效，关闭后台标签或最后一个标签只影响对应会话/分屏');

  serial = spawn('/usr/bin/python3', ['tests/serial-fixture.py'], { stdio: 'pipe' });
  let device; let serialReceived = '';
  createInterface({ input: serial.stdout }).on('line', line => {
    const data = JSON.parse(line); if (data.path) device = data.path;
    if (data.received) serialReceived += Buffer.from(data.received, 'base64').toString();
  });
  await until(() => device);
  await page.evaluate(async device => {
    __test.tabs.uart = await __test.layout.openInPane(__test.right, { type: 'serial', name: 'UART', options: { port: device, baudrate: 115200 } });
    __test.tabs.uart.setCustomTitle('UART');
  }, device);
  await page.waitForFunction(() => __test.tabs.uart.session?.open);
  await page.evaluate(() => __test.right.select(__test.tabs.right2));
  serial.stdin.write(JSON.stringify({ write: Buffer.from('UART_BACKGROUND=still-alive\r\n').toString('base64') }) + '\n');
  await until(async () => (await visibleText(page, 'uart')).includes('UART_BACKGROUND=still-alive'));
  await selectText(page, 'uart', 'UART_BACKGROUND=still-alive');
  const uartReference = await page.evaluate(() => __test.references.createFromSelection(__test.references.activeTerminal()));
  assert.equal(uartReference.source.kind, 'serial');
  assert.notEqual(uartReference.source.terminal_id, reference.source.terminal_id);
  await page.evaluate(() => { __test.tabs.uart.frontend.clearSelection(); __test.right.select(__test.tabs.uart); });
  await page.waitForFunction(() => __test.app.activeTab === __test.root && document.activeElement === __test.tabs.uart.frontend.xterm.textarea);
  await page.keyboard.type('UART_TX_OK');
  await until(() => serialReceived.includes('UART_TX_OK'));
  pass('分屏内原生串口在后台持续接收，切回后可发送并引用正确来源');

  await page.evaluate(async () => {
    __test.tabs.codex = await __test.layout.openCodex(__test.left);
    __test.tabs.codex.setCustomTitle('Codex');
  });
  await page.waitForFunction(() => __test.tabs.codex.frontendIsReady && __test.tabs.codex.session?.open);
  await until(async () => {
    const text = await visibleText(page, 'codex'); return /Ask Codex to do anything/.test(text) && !/\bloading\b/.test(text);
  }, 25000);
  await page.waitForFunction(() => document.activeElement === __test.tabs.codex.frontend.xterm.textarea);
  await page.keyboard.type('pane-draft-check');
  await until(async () => (await visibleText(page, 'codex')).includes('pane-draft-check'));
  await page.evaluate(() => { __test.codexSession = __test.tabs.codex.session; __test.left.select(__test.tabs.left); });
  await page.waitForFunction(() => document.activeElement === __test.tabs.left.frontend.xterm.textarea);
  await page.evaluate(() => __test.left.select(__test.tabs.codex));
  await page.waitForFunction(() => document.activeElement === __test.tabs.codex.frontend.xterm.textarea);
  assert.equal(await page.evaluate(() => __test.tabs.codex.session === __test.codexSession && __test.tabs.codex.session.open), true);
  assert.ok((await visibleText(page, 'codex')).includes('pane-draft-check'));
  // Native split resizing changes the active TUI dimensions and the right terminal independently.
  const initialCols = await page.evaluate(() => __test.tabs.codex.size.columns);
  await page.evaluate(() => { __test.root.root.ratios = [.65, .35]; __test.root.layout(); });
  await page.waitForFunction(cols => __test.tabs.codex.size.columns > cols, initialCols);
  await page.evaluate(() => __test.root.navigate('r'));
  await page.waitForFunction(() => document.activeElement === __test.right.active.frontend.xterm.textarea);
  await page.evaluate(() => __test.left.focusPane());
  await delay(300);
  await page.screenshot({ path: join(dir, 'codex-pane-tabs.png') });
  writeFileSync(join(dir, 'codex-screen.txt'), await visibleText(page, 'codex'));
  pass('原版 Codex 界面在内部标签运行，切换保持同一会话和未发送草稿，分屏缩放与焦点导航正常');

  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  if (instance) {
    console.error('RENDERER_ERRORS', instance.errors);
    for (const name of ['left', 'right1', 'right2', 'uart', 'codex']) {
      await visibleText(instance.page, name).then(text => writeFileSync(join(dir, name + '.txt'), text)).catch(() => {});
    }
    console.error('FOCUS_STATE', await instance.page.evaluate(() => ({
      top: __test.app.activeTab === __test.root ? 'original' : __test.app.activeTab === __test.restored ? 'restored' : 'other',
      focused: Object.entries(__test.tabs).filter(([_, t]) => t.frontend?.xterm?.textarea === document.activeElement).map(([name]) => name),
    })).catch(() => null));
    await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  }
  console.error('ARTIFACTS', dir);
  throw error;
} finally { if (instance) await instance.close(); if (serial) serial.kill(); }
