import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchTabby, openProfile, selectText, visibleText, until, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-direct-reference-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
let instance;
const shell = { type: 'local', name: 'shell', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd: workspace } };
const codex = { type: 'local', name: 'Codex', options: { command: '/home/douzhk/.local/bin/codex', args: [], cwd: workspace } };
const fixture = { type: 'local', name: '日志', options: { command: '/usr/bin/python3', args: ['-u', '-c',
  'import os,tty\nprint("UART_DIRECT_A_5279\\nGDB_DIRECT_B_3186\\nLATE_SOURCE_C_7392",flush=True)\ntty.setraw(0)\nwhile True:\n b=os.read(0,4096)\n if not b: break\n os.write(1,b)'], cwd: workspace } };
async function ready(page, name) {
  await page.waitForFunction(name => __test.tabs[name]?.frontendIsReady && __test.tabs[name]?.session?.open, name);
  await until(async () => {
    const screen = await visibleText(page, name);
    return /Ask Codex to do anything/.test(screen) && /for agents|for shortcuts/.test(screen) && !/\bloading\b/.test(screen);
  }, 40000);
}
async function delivered(page, text, name) {
  await until(async () => (await visibleText(page, name)).includes(text));
  await page.waitForFunction(() => __test.direct.pending === 0);
}
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await page.evaluate(() => {
    const w = require('@electron/remote').getCurrentWindow(); w.unmaximize(); w.setSize(1600, 1000);
    __test.direct = __test.injector.get(__test.plugin.CodexReferenceService);
    __test.layout = __test.injector.get(__test.plugin.PaneLayoutService);
    const notifications = __test.injector.get(__test.core.NotificationsService);
    const info = notifications.info.bind(notifications); __test.notices = [];
    notifications.info = (...args) => { __test.notices.push(args); return info(...args); };
  });
  await openProfile(page, 'codex-a', shell);
  await page.keyboard.type('codex'); await page.keyboard.press('Enter');
  await ready(page, 'codex-a');
  await page.keyboard.type('existing-draft-KEEP');
  await page.evaluate(async fixture => {
    const s = __test; s.root = s.tabs['codex-a'].topmostParent;
    s.left = s.layout.enable(s.root); s.right = await s.layout.split(s.left, 'r');
    s.tabs.source = await s.layout.openInPane(s.right, fixture);
    s.tabs.source.setCustomTitle('串口日志');
    s.sessionA = s.tabs['codex-a'].session;
  }, fixture);
  await page.waitForFunction(() => __test.tabs.source.frontendIsReady && __test.tabs.source.session?.open);
  await page.evaluate(() => {
    const s = __test;
    s.inputA = []; s.inputSource = [];
    s.packets = [];
    const send = s.tabs['codex-a'].sendInput.bind(s.tabs['codex-a']);
    s.tabs['codex-a'].sendInput = data => { s.packets.push(data.toString()); return send(data); };
    s.tabs['codex-a'].frontend.input$.subscribe(x => s.inputA.push(x.toString('hex')));
    s.tabs.source.frontend.input$.subscribe(x => s.inputSource.push(x.toString('hex')));
    s.platform = s.injector.get(s.core.PlatformService); s.platform.setClipboard({ text: 'KEEP_CLIPBOARD' });
  });
  await selectText(page, 'source', 'UART_DIRECT_A_5279');
  await page.waitForFunction(() => __test.direct.ready(__test.tabs['codex-a']));
  const check = await page.evaluate(async () => {
    const s = __test; const intent = s.direct.capture(s.tabs.source, s.references.capture(s.tabs.source));
    const c = intent.candidates[0]; const t = c.tab.frontend.xterm;
    return { process: !!await s.direct.probe(c), ready: s.direct.ready(c.tab), cursor: t.buffer.active.cursorY,
      hidden: (t._core?.coreService ?? t._core?._coreService)?.isCursorHidden, bracketed: c.tab.frontend.supportsBracketedPaste(),
      lines: Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(t.buffer.active.baseY+i)?.translateToString(true)) };
  });
  writeFileSync(join(dir, 'composer-check.json'), JSON.stringify(check, null, 2));
  assert.equal(check.process, true, 'Manually started foreground Codex must be recognized');
  assert.equal(check.ready, true, 'Actual Codex composer must pass the screen check');
  await page.evaluate(() => { __test.focusBefore = document.activeElement; });
  await page.keyboard.press('Control+Shift+Y');
  await delivered(page, 'UART_DIRECT_A_5279', 'codex-a');
  assert.match(await visibleText(page, 'codex-a'), /existing-draft-KEEP/);
  assert.equal(await page.evaluate(() => document.activeElement === __test.focusBefore && __test.tabs['codex-a'].session === __test.sessionA), true);
  assert.equal(await page.evaluate(() => __test.platform.readClipboard()), 'KEEP_CLIPBOARD');
  assert.deepEqual(await page.evaluate(() => __test.inputSource), []);
  const allPackets = await page.evaluate(() => __test.packets);
  writeFileSync(join(dir, 'first-input-packets.json'), JSON.stringify(allPackets));
  const packets = allPackets.filter(x => x.startsWith('\x1b[200~'));
  assert.equal(packets.length, 1);
  assert.ok(packets[0].startsWith('\x1b[200~') && packets[0].endsWith('\x1b[201~'));
  assert.ok(!packets[0].includes('\r'));
  pass('右侧真实快捷键投递到手动启动的 Codex 草稿，保留已有草稿、源焦点、剪贴板及会话');

  await page.evaluate(async codex => {
    const s = __test; s.tabs['codex-b'] = await s.layout.openInPane(s.left, codex); s.tabs['codex-b'].setCustomTitle('codex-b');
  }, codex);
  await ready(page, 'codex-b');
  await selectText(page, 'source', 'GDB_DIRECT_B_3186');
  await page.evaluate(async () => (await __test.tabs.source.buildContextMenu()).find(x => x.label === '引用到 Codex').click());
  await delivered(page, 'GDB_DIRECT_B_3186', 'codex-b');
  assert.ok(!(await visibleText(page, 'codex-a')).includes('GDB_DIRECT_B_3186'));
  pass('左侧切换到另一 Codex 标签后引用跟随当前显示项，隐藏的 Codex 不接收');

  // Delay persistence only, exercising a real UI target change during an in-flight operation.
  await selectText(page, 'source', 'LATE_SOURCE_C_7392');
  await page.evaluate(() => {
    const s = __test; s.originalRequest = s.direct.bridge.request.bind(s.direct.bridge);
    s.direct.bridge.request = async (...args) => {
      if (args[1] === 'create') { s.saveReached = true; await new Promise(resolve => { s.releaseSave = resolve; }); }
      return s.originalRequest(...args);
    };
  });
  await page.keyboard.press('Control+Shift+Y');
  await page.waitForFunction(() => __test.saveReached);
  await page.evaluate(() => { __test.left.select(__test.tabs['codex-a'], false); __test.releaseSave(); });
  await page.waitForFunction(() => __test.direct.pending === 0);
  assert.ok(!(await visibleText(page, 'codex-a')).includes('LATE_SOURCE_C_7392'));
  assert.ok(!(await visibleText(page, 'codex-b')).includes('LATE_SOURCE_C_7392'));
  assert.match(await page.evaluate(() => __test.platform.readClipboard()), /LATE_SOURCE_C_7392/);
  await page.evaluate(() => { __test.direct.bridge.request = __test.originalRequest; });
  pass('异步保存期间切换目标标签时取消投递并复制备用，既不改发新标签也不写入隐藏标签');

  // Actual Codex picker must not receive a log as a command or choice.
  await page.evaluate(async codex => {
    __test.tabs['codex-menu'] = await __test.layout.openInPane(__test.left, codex);
  }, codex);
  await ready(page, 'codex-menu');
  await page.waitForFunction(() => document.activeElement === __test.tabs['codex-menu'].frontend.xterm.textarea);
  await page.keyboard.type('/model'); await delay(500); await page.keyboard.press('Enter');
  await until(async () => /Select.*model|选择模型/i.test(await visibleText(page, 'codex-menu')));
  writeFileSync(join(dir, 'model-picker.txt'), await visibleText(page, 'codex-menu'));
  await selectText(page, 'source', 'LATE_SOURCE_C_7392');
  await page.keyboard.press('Control+Shift+Y');
  await page.waitForFunction(() => __test.direct.pending === 0);
  assert.ok(!(await visibleText(page, 'codex-menu')).includes('LATE_SOURCE_C_7392'));
  assert.match(await page.evaluate(() => __test.platform.readClipboard()), /LATE_SOURCE_C_7392/);
  pass('Codex 模型选择界面不接收日志，退回复制而不发送按键');
  await page.evaluate(() => __test.left.select(__test.tabs['codex-menu']));
  await page.keyboard.press('Escape');

  // An ordinary Shell in the remembered pane must never be selected by its title.
  await page.evaluate(async shell => {
    __test.tabs.fake = await __test.layout.openInPane(__test.left, shell); __test.tabs.fake.setCustomTitle('Codex');
  }, shell);
  await page.waitForFunction(() => __test.tabs.fake.session?.open);
  await selectText(page, 'source', 'LATE_SOURCE_C_7392');
  await page.keyboard.press('Control+Shift+Y');
  await page.waitForFunction(() => __test.direct.pending === 0);
  assert.ok(!(await visibleText(page, 'fake')).includes('LATE_SOURCE_C_7392'));
  pass('接收分屏切到名为 Codex 的普通 Shell 时不投递，不按标签名误判');

  // A second visible Codex forces a real picker once; later references follow that pane.
  await page.evaluate(async codex => {
    const s = __test; s.left.select(s.tabs['codex-a']);
    s.bottom = await s.layout.split(s.right, 'b');
    s.tabs['codex-other'] = await s.layout.openInPane(s.bottom, codex); s.tabs['codex-other'].setCustomTitle('another-codex');
    s.direct.receivers.delete(s.root);
  }, codex);
  await ready(page, 'codex-other');
  await selectText(page, 'source', 'GDB_DIRECT_B_3186');
  await page.keyboard.press('Control+Shift+Y');
  await page.locator('selector-modal').waitFor();
  await page.locator('selector-modal').getByText(/another-codex/).click();
  await delivered(page, 'GDB_DIRECT_B_3186', 'codex-other');
  assert.ok(!(await visibleText(page, 'codex-a')).includes('GDB_DIRECT_B_3186'));
  await selectText(page, 'source', 'UART_DIRECT_A_5279');
  await page.keyboard.press('Control+Shift+Y');
  await delivered(page, 'UART_DIRECT_A_5279', 'codex-other');
  assert.equal(await page.locator('selector-modal').count(), 0);
  pass('同时可见多个 Codex 时实际选择接收分屏，后续复用选择并保持其他分屏草稿');

  // Use a real Codex process exit inside a persistent shell, then try another source.
  await page.evaluate(async () => {
    const s = __test; s.direct.receivers.set(s.root, s.left); s.left.select(s.tabs['codex-a'], false);
    const c = s.direct.capture(s.tabs.source, s.references.capture(s.tabs.source)).candidates.find(c => c.tab === s.tabs['codex-a']);
    const processInfo = await s.direct.probe(c); process.kill(processInfo.pid, 'SIGTERM');
  });
  await until(async () => /bash-[\d.]+[$#]/.test((await visibleText(page, 'codex-a')).split('\n').slice(-12).join('\n')));
  await selectText(page, 'source', 'LATE_SOURCE_C_7392');
  const beforeExitPaste = await page.evaluate(() => __test.packets.filter(x => x.startsWith('\x1b[200~')).length);
  await page.keyboard.press('Control+Shift+Y');
  await page.waitForFunction(() => __test.direct.pending === 0);
  assert.equal(await page.evaluate(() => __test.packets.filter(x => x.startsWith('\x1b[200~')).length), beforeExitPaste);
  assert.ok(!(await visibleText(page, 'codex-a')).includes('LATE_SOURCE_C_7392'));
  pass('真实 Codex 退出回到原 Shell 后取消投递，存活的其他 Codex 不会自动成为替代目标');

  // No other outer work page is searched, even if it has a visible Codex.
  await openProfile(page, 'other-source', fixture);
  await selectText(page, 'other-source', 'LATE_SOURCE_C_7392');
  await page.keyboard.press('Control+Shift+Y');
  await page.waitForFunction(() => __test.direct.pending === 0);
  assert.ok(!(await visibleText(page, 'codex-other')).includes('LATE_SOURCE_C_7392'));
  assert.match(await page.evaluate(() => __test.platform.readClipboard()), /LATE_SOURCE_C_7392/);
  pass('另一顶部工作页的引用不跨页查找或写入先前 Codex');

  // Long logs use an intact snapshot and keep the actual composer compact.
  await selectText(page, 'source', 'UART_DIRECT_A_5279');
  const long = 'UART_LONG_🧪\n'.repeat(1500);
  const longReference = await page.evaluate(async text => {
    const s = __test; s.direct.receivers.set(s.root, s.bottom);
    const selection = s.references.capture(s.tabs.source); selection.text = text;
    return s.direct.send(s.direct.capture(s.tabs.source, selection));
  }, long);
  assert.ok(longReference);
  assert.equal(readFileSync(longReference.path.replace('reference.md', 'content.txt'), 'utf8'), long);
  await until(async () => (await visibleText(page, 'codex-other')).includes('完整日志快照'));
  pass('长日志以完整快照路径进入实际 Codex 草稿，完整 Unicode 内容保存在文件中');

  await page.evaluate(() => { __test.left.select(__test.tabs['codex-b']); __test.right.select(__test.tabs.source); });
  await page.screenshot({ path: join(dir, 'direct-reference.png') });
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  console.error('ARTIFACTS', dir);
  writeFileSync(join(dir, 'failure.txt'), String(error.stack));
  if (instance) {
    console.error(instance.errors);
    const state = await instance.page.evaluate(() => ({ notices: __test.notices, tabs: Object.fromEntries(Object.entries(__test.tabs).map(([name,tab]) => {
      const term = tab.frontend?.xterm; if (!term) return [name,null]; const b = term.buffer.active;
      return [name, { ready: __test.direct.ready(tab), hidden: term._core.coreService?.isCursorHidden, rows:term.rows, cursor:b.cursorY,
        lines:Array.from({length:term.rows},(_,i)=>b.getLine(b.baseY+i)?.translateToString(true)) }];
    })) })).catch(()=>null);
    writeFileSync(join(dir, 'failure-state.json'), JSON.stringify(state,null,2));
    for (const name of ['codex-a','codex-b','codex-other','codex-menu','source']) await visibleText(instance.page, name).then(text => writeFileSync(join(dir, name+'.txt'), text)).catch(()=>{});
    await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(()=>{});
  }
  throw error;
} finally { if(instance) await instance.close(); }
