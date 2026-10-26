import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchTabby, openProfile, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-pane-actions-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
let instance;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await page.evaluate(() => { const win = require('@electron/remote').getCurrentWindow(); win.unmaximize(); win.setSize(1200, 800); });
  await openProfile(page, 'original', { type: 'local', name: 'Shell', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd: workspace } });
  await page.evaluate(() => {
    const s = __test;
    s.layout = s.injector.get(s.plugin.PaneLayoutService);
    s.root = s.tabs.original.parent;
    s.topCount = s.app.tabs.length;
  });
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.app.tabs.length === __test.topCount + 1 && __test.app.activeTab !== __test.root);
  await delay(150);
  assert.equal(await page.evaluate(() => __test.app.tabs.length), await page.evaluate(() => __test.topCount + 1));
  pass('普通终端 Ctrl+Shift+T 仍只新建一个顶部标签');

  // A native split also gains pane tabs when the user invokes the native new-tab command.
  await page.evaluate(async () => {
    const s = __test;
    s.app.selectTab(s.root);
    s.nativeRight = await s.root.splitTab(s.tabs.original, 'r');
    s.nativeRight.setCustomTitle('right');
    s.root.focus(s.nativeRight);
  });
  await page.waitForFunction(() => __test.nativeRight.session?.open && document.activeElement === __test.nativeRight.frontend.xterm.textarea);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await delay(200);
  assert.equal(await page.locator('split-tab-pane-label.active').count(), 0);
  pass('按住 Ctrl+Shift 不显示分屏名称浮层');
  await page.keyboard.press('T');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => __test.root.getAllTabs().every(p => p instanceof __test.plugin.PaneTabsComponent) && __test.nativeRight.parent.tabs.length === 2);
  await page.evaluate(() => { __test.right = __test.nativeRight.parent; __test.left = __test.tabs.original.parent; });
  await page.waitForFunction(() => __test.right.active.session?.open && document.activeElement === __test.right.active.frontend.xterm.textarea);
  assert.deepEqual(await page.evaluate(() => [__test.app.tabs.length - __test.topCount, __test.left.tabs.length, __test.right.tabs.length]), [1, 1, 2]);
  pass('原生分屏中 Ctrl+Shift+T 自动建立内部标签，仅在当前分屏新增');

  const panes = page.locator('workbench-pane-tabs');
  await panes.nth(0).getByRole('tab', { name: 'original', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === __test.tabs.original.frontend.xterm.textarea);
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.left.tabs.length === 2 && __test.left.active.session?.open);
  await page.waitForFunction(() => document.activeElement === __test.left.active.frontend.xterm.textarea);
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.left.tabs.length === 3 && __test.left.active.session?.open);
  await delay(150);
  assert.deepEqual(await page.evaluate(() => [__test.app.tabs.length - __test.topCount, __test.left.tabs.length, __test.right.tabs.length]), [1, 3, 2]);
  pass('焦点切换到左侧后，连续两次快捷键各新增一个内部标签，右侧与顶部不变');

  // Use real mouse double-click and the native rename dialog, not direct setCustomTitle calls.
  await panes.nth(0).getByRole('tab', { name: 'original', exact: true }).dblclick();
  const input = page.locator('rename-tab-modal input');
  await input.waitFor();
  await input.fill('编译日志');
  await input.press('Enter');
  await input.waitFor({ state: 'detached' });
  await panes.nth(0).getByRole('tab', { name: '编译日志', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => __test.tabs.original.customTitle), '编译日志');
  assert.equal(await page.evaluate(() => __test.nativeRight.customTitle), 'right');
  pass('双击非当前内部标签可改名为中文，只修改双击的终端');

  await panes.nth(0).getByRole('tab', { name: '编译日志', exact: true }).dblclick();
  await input.waitFor();
  await input.fill('取消的名称');
  await input.press('Escape');
  await input.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => __test.tabs.original.customTitle), '编译日志');
  const token = await page.evaluate(() => __test.injector.get(__test.core.TabRecoveryService).getFullRecoveryToken(__test.left, { includeState: true }));
  assert.equal(token.children[0].tabCustomTitle, '编译日志');
  pass('取消改名保留原名称，保存的布局恢复令牌包含新名称');

  // Renaming is text input: the shortcut must not create a terminal behind that dialog.
  await panes.nth(0).getByRole('tab', { name: '编译日志', exact: true }).dblclick();
  await input.waitFor();
  await input.focus();
  await page.keyboard.press('Control+Shift+T');
  await delay(250);
  assert.deepEqual(await page.evaluate(() => [__test.app.tabs.length - __test.topCount, __test.left.tabs.length, __test.right.tabs.length]), [1, 3, 2]);
  await input.press('Escape');
  await input.waitFor({ state: 'detached' });
  pass('名称编辑框中不触发新建终端');

  // User-customized native new-tab bindings route through the same context rule.
  await page.evaluate(() => {
    const s = __test;
    s.config = s.injector.get(s.core.ConfigService);
    s.originalBinding = s.config.store.hotkeys['new-tab'];
    s.config.store.hotkeys['new-tab'] = ['Ctrl-Alt-T'];
    s.right.select(s.nativeRight);
  });
  await page.waitForFunction(() => document.activeElement === __test.nativeRight.frontend.xterm.textarea);
  await page.keyboard.press('Control+Alt+T');
  await page.waitForFunction(() => __test.right.tabs.length === 3 && __test.right.active.session?.open);
  assert.equal(await page.evaluate(() => __test.app.tabs.length - __test.topCount), 1);
  await page.evaluate(() => { __test.config.store.hotkeys['new-tab'] = __test.originalBinding; });
  pass('沿用用户自定义的新建终端按键，不覆盖快捷键设置');

  await panes.nth(0).getByRole('tab', { name: '编译日志', exact: true }).click();
  await page.screenshot({ path: join(dir, 'pane-actions.png') });
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  console.error('ARTIFACTS', dir);
  if (instance) {
    console.error('RENDERER_ERRORS', instance.errors);
    await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally { if (instance) await instance.close(); }
