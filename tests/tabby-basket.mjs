import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchTabby, openProfile, selectText, until, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-basket-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const otherProject = join(dir, 'other-project'); mkdirSync(otherProject);
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
let instance; let serial;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const page = instance.page;
  await page.evaluate(() => {
    __test.basket = __test.injector.get(__test.plugin.ReferenceBasketService);
    __test.injector.get(__test.core.ConfigService).store.hotkeys['reference-basket-collect'] = ['Ctrl-Shift-J'];
    const win = require('@electron/remote').getCurrentWindow(); win.unmaximize(); win.setSize(1200, 900);
  });
  // A brand new project must have an empty usable basket without first creating a snapshot.
  await page.evaluate(() => __test.basket.open());
  // Allow the independent Node worker to cold-start; check rendering separately from disk work.
  await page.waitForFunction(() => !__test.app.activeTab.busy, null, { timeout: 20000 });
  await page.getByRole('heading', { name: '从一段终端输出开始' }).waitFor({ timeout: 3000 });
  assert.equal(await page.locator('reference-basket [role=alert]').count(), 0);
  pass('新项目可直接打开空引用篮');

  const program = 'import sys,tty,os\nprint("BUILD_EVIDENCE=failed-8429",flush=True)\ntty.setraw(0)\nwhile True:\n b=os.read(0,4096)\n if not b: break\n os.write(1,b)';
  await openProfile(page, '编译终端', { type: 'local', name: 'build', options: { command: '/usr/bin/python3', args: ['-u', '-c', program], cwd: workspace } });
  await selectText(page, '编译终端', 'BUILD_EVIDENCE=failed-8429');
  await page.evaluate(async () => {
    const s = __test;
    s.inputs = []; s.tabs['编译终端'].frontend.input$.subscribe(data => s.inputs.push(data.toString('hex')));
    s.basket.platform.setClipboard({ text: 'KEEP_CLIPBOARD' });
    const provider = s.injector.get(s.core.TabContextMenuItemProvider).find(p => p instanceof s.plugin.ReferenceMenu);
    const menu = await provider.getItems(s.tabs['编译终端']);
    s.addAction = menu.find(item => item.label === 'Codex 引用').submenu.find(item => item.label === '加入引用篮（备用）');
    if (!s.addAction?.enabled) throw new Error('Basket action is not available');
    s.tabs['编译终端'].frontend.clearSelection();
  });
  serial = spawn('python3', ['tests/serial-fixture.py'], { stdio: 'pipe' });
  let device;
  createInterface({ input: serial.stdout }).on('line', line => { const data = JSON.parse(line); if (data.path) device = data.path; });
  await until(() => device);
  await openProfile(page, '板卡串口', { type: 'serial', name: 'uart', options: { port: device, baudrate: 115200 } });
  serial.stdin.write(JSON.stringify({ write: Buffer.from('UART_EVIDENCE=reset-9618\r\n').toString('base64') }) + '\n');
  await selectText(page, '板卡串口', 'UART_EVIDENCE=reset-9618');
  // Selection, source and project are pinned at menu construction, even after focus/project changes.
  await page.evaluate(otherProject => {
    const s = __test;
    s.tabs['板卡串口'].frontend.input$.subscribe(data => s.inputs.push(data.toString('hex')));
    s.activeBefore = s.app.activeTab; s.focusBefore = document.activeElement;
    s.injector.get(s.core.ConfigService).store.codexReferences.workspace = otherProject;
    s.addAction.click();
  }, otherProject);
  await until(() => page.evaluate(workspace => __test.basket.count(workspace) === 1, workspace));
  assert.equal(await page.evaluate(() => __test.app.activeTab === __test.activeBefore && document.activeElement === __test.focusBefore), true);
  assert.equal(await page.evaluate(() => __test.basket.platform.readClipboard()), 'KEEP_CLIPBOARD');
  await page.evaluate(workspace => { __test.injector.get(__test.core.ConfigService).store.codexReferences.workspace = workspace; }, workspace);
  pass('右键添加固定选区与项目来源；切到其他终端后执行仍正确，焦点和剪贴板保持');

  await page.keyboard.press('Control+Shift+J');
  await until(() => page.evaluate(workspace => __test.basket.count(workspace) === 2, workspace));
  assert.equal(await page.evaluate(() => __test.app.activeTab === __test.activeBefore && document.activeElement === __test.focusBefore), true);
  assert.equal(await page.evaluate(() => __test.basket.platform.readClipboard()), 'KEEP_CLIPBOARD');
  assert.deepEqual(await page.evaluate(() => __test.inputs), []);
  await page.keyboard.press('Control+Shift+B');
  await page.waitForFunction(() => __test.app.activeTab instanceof __test.plugin.ReferenceBasketTab && __test.app.activeTab.items.length === 2 && !__test.app.activeTab.busy);
  assert.deepEqual(await page.evaluate(() => __test.inputs), []);
  const sources = await page.evaluate(() => __test.app.activeTab.items.map(i => i.reference.source));
  assert.deepEqual(sources.map(s => [s.name, s.kind]), [['编译终端', 'local'], ['板卡串口', 'serial']]);
  assert.notEqual(sources[0].terminal_id, sources[1].terminal_id);
  pass('为备用收集绑定 Ctrl+Shift+J 后跨终端收集，Ctrl+Shift+B 打开整理页，按键不进入终端输入流');

  const basketPage = page.locator('reference-basket');
  await basketPage.locator('summary').first().click();
  await basketPage.locator('pre').first().getByText('BUILD_EVIDENCE=failed-8429', { exact: true }).waitFor({ timeout: 3000 });
  await basketPage.getByRole('textbox', { name: '引用 1 的备注' }).fill('这段是刷机前的编译结果');
  await page.keyboard.press('Control+Shift+Y');
  await page.keyboard.press('Control+Shift+B');
  assert.equal(await page.evaluate(() => __test.app.activeTab.items.length), 2);
  await basketPage.getByRole('button', { name: '复制全部引用', exact: true }).click();
  await page.waitForFunction(() => !__test.app.activeTab.busy && !!__test.app.activeTab.message);
  await basketPage.getByRole('status').waitFor({ timeout: 3000 });
  let clipboard = await page.evaluate(() => __test.basket.platform.readClipboard());
  assert.match(clipboard, /这段是刷机前的编译结果/);
  assert.match(clipboard, /BUILD_EVIDENCE=failed-8429/); assert.match(clipboard, /UART_EVIDENCE=reset-9618/);
  assert.match(clipboard, /编译终端/); assert.match(clipboard, /板卡串口/);
  assert.ok(clipboard.indexOf('BUILD_EVIDENCE') < clipboard.indexOf('UART_EVIDENCE'));
  await basketPage.getByRole('button', { name: '上移引用 2', exact: true }).click();
  await page.waitForFunction(() => !__test.app.activeTab.busy && __test.app.activeTab.items[0].reference.source.kind === 'serial');
  await basketPage.getByRole('button', { name: '复制全部引用', exact: true }).click();
  await page.waitForFunction(() => !__test.app.activeTab.busy && !!__test.app.activeTab.message);
  clipboard = await page.evaluate(() => __test.basket.platform.readClipboard());
  assert.ok(clipboard.indexOf('UART_EVIDENCE') < clipboard.indexOf('BUILD_EVIDENCE'));
  await page.screenshot({ path: join(dir, 'basket.png') });
  pass('真实整理页预览、备注自动保存、排序与整篮复制，编辑备注时快捷键不触发收集');

  // Reopening an existing basket must return to the terminal from which it was opened.
  await selectText(page, '板卡串口', 'UART_EVIDENCE=reset-9618');
  await page.keyboard.press('Control+Shift+B');
  await page.waitForFunction(() => __test.app.activeTab instanceof __test.plugin.ReferenceBasketTab && !__test.app.activeTab.busy);
  await basketPage.getByRole('button', { name: '返回终端', exact: true }).click();
  await page.waitForFunction(() => __test.app.activeTab === __test.tabs['板卡串口'].topmostParent);
  await page.evaluate(() => __test.basket.open());
  await page.waitForFunction(() => !__test.app.activeTab.busy);
  pass('复用已有引用篮页面，返回最近打开它的终端');

  const ids = await page.evaluate(() => __test.app.activeTab.items.map(i => i.id));
  serial.stdin.write(JSON.stringify({ write: Buffer.from('NEW_UART_OUTPUT\r\n'.repeat(200)).toString('base64') }) + '\n');
  assert.equal(readFileSync(join(workspace, '.terminal-references', ids[0], 'content.txt'), 'utf8'), 'UART_EVIDENCE=reset-9618');
  await page.evaluate(otherProject => { __test.injector.get(__test.core.ConfigService).store.codexReferences.workspace = otherProject; }, otherProject);
  await page.evaluate(() => __test.basket.open());
  await page.waitForFunction(otherProject => __test.app.activeTab.workspace === otherProject && !__test.app.activeTab.busy, otherProject);
  assert.equal(await page.evaluate(() => __test.app.activeTab.items.length), 0);
  assert.equal(JSON.parse(readFileSync(join(workspace, '.terminal-references/basket.json'))).entries.length, 2);
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  await instance.close(); instance = null;
  serial.kill(); serial = null;
  pass('串口继续滚动不改快照，切换项目不混入其他引用篮');

  instance = await launchTabby(join(dir, 'reopened'), workspace);
  const reopened = instance.page;
  await reopened.evaluate(() => { __test.basket = __test.injector.get(__test.plugin.ReferenceBasketService); return __test.basket.open(); });
  await reopened.waitForFunction(() => __test.app.activeTab.items.length === 2 && !__test.app.activeTab.busy);
  assert.deepEqual(await reopened.evaluate(() => __test.app.activeTab.items.map(i => i.id)), ids);
  assert.equal(await reopened.getByRole('textbox', { name: '引用 2 的备注' }).inputValue(), '这段是刷机前的编译结果');
  const toolbar = await reopened.evaluate(() => __test.injector.get(__test.core.ToolbarButtonProvider).flatMap(p => p.provide()).map(b => b.title));
  assert.ok(toolbar.includes('引用篮（2）')); assert.ok(!toolbar.some(t => t?.includes('Codex')));
  pass('关闭并重新启动后恢复引用、备注和顺序；工具栏显示引用篮，不再提供 Codex 启动图标');

  // A corrupt snapshot must never partially replace the clipboard.
  const contentPath = join(workspace, '.terminal-references', ids[0], 'content.txt');
  chmodSync(contentPath, 0o600); writeFileSync(contentPath, 'tampered');
  await reopened.evaluate(() => __test.basket.platform.setClipboard({ text: 'PRESERVE_ON_ERROR' }));
  await reopened.getByRole('button', { name: '复制全部引用', exact: true }).click();
  await reopened.locator('reference-basket [role=alert]').waitFor({ timeout: 3000 });
  assert.equal(await reopened.evaluate(() => __test.basket.platform.readClipboard()), 'PRESERVE_ON_ERROR');
  await reopened.getByRole('button', { name: '移除引用 1', exact: true }).click();
  await reopened.waitForFunction(() => __test.app.activeTab.items.length === 1 && !__test.app.activeTab.busy);
  // Only the OS confirmation response is substituted; the real UI action and worker still execute.
  await reopened.evaluate(() => { __test.basket.platform.showMessageBox = async () => ({ response: 1 }); });
  await reopened.getByRole('button', { name: '清空引用篮', exact: true }).click();
  await reopened.getByRole('heading', { name: '从一段终端输出开始' }).waitFor({ timeout: 3000 });
  assert.equal(readdirSync(join(workspace, '.terminal-references')).filter(x => x.startsWith('ref_')).length, 2);
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  pass('坏快照阻止复制且保留剪贴板；移除和清空只整理篮子，保留快照文件');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  console.error('ARTIFACTS', dir);
  writeFileSync(join(dir, 'failure.txt'), String(error.stack));
  if (instance) {
    console.error('RENDERER_ERRORS', instance.errors);
    const state = await instance.page.evaluate(() => ({ busy: __test.app.activeTab?.busy, error: __test.app.activeTab?.error,
      items: __test.app.activeTab?.items?.length, pending: __test.basket?.pending })).catch(() => null);
    writeFileSync(join(dir, 'failure-state.json'), JSON.stringify(state, null, 2));
    await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally { if (serial) serial.kill(); if (instance) await instance.close(); }
