import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchTabby, openProfile, delay } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-pane-navigation-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const profile = { type: 'local', name: 'Shell', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd: workspace } };
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
let instance;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await page.evaluate(() => { const w = require('@electron/remote').getCurrentWindow(); w.unmaximize(); w.setSize(1200, 800); });
  await openProfile(page, 'left-1', profile);
  await openProfile(page, 'outer', profile);
  await page.evaluate(() => { __test.root = __test.tabs['left-1'].parent; __test.layout = __test.injector.get(__test.plugin.PaneLayoutService); });
  await page.keyboard.press('Alt+1');
  await page.waitForFunction(() => __test.app.activeTab === __test.root);
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(() => __test.app.activeTab === __test.tabs.outer.parent);
  pass('普通终端 Alt+数字仍切换顶部标签');

  // Call the actual menu built for the terminal body, including native providers.
  await page.evaluate(async () => {
    const s = __test;
    s.app.selectTab(s.root);
    const items = await s.tabs['left-1'].buildContextMenu();
    s.menuLabels = items.filter(x => x.label).map(x => x.label);
    items.find(x => x.label === '向右分屏').click();
  });
  await page.waitForFunction(() => __test.root.getAllTabs().length === 2 && __test.root.getAllTabs().every(p => p.active?.session?.open));
  assert.ok((await page.evaluate(() => __test.menuLabels)).includes('向下分屏'));
  assert.ok(!(await page.evaluate(() => __test.menuLabels)).includes('分屏内标签'));
  await page.evaluate(() => {
    __test.left = __test.tabs['left-1'].parent;
    __test.right = __test.root.getAllTabs().find(p => p !== __test.left);
    __test.right.active.setCustomTitle('right-1');
  });
  // Menu must split the terminal it was opened on, even if another pane has focus.
  await page.evaluate(async () => {
    const s = __test;
    const items = await s.right.active.buildContextMenu();
    s.left.focusPane();
    items.find(x => x.label === '向下分屏').click();
  });
  await page.waitForFunction(() => __test.root.getAllTabs().length === 3 && __test.root.getAllTabs().every(p => p.active?.session?.open));
  const geometry = await page.evaluate(() => {
    const s = __test;
    s.bottom = s.root.getAllTabs().find(p => p !== s.left && p !== s.right);
    s.bottom.active.setCustomTitle('bottom-1');
    return [s.left, s.right, s.bottom].map(p => s.root.getPaneGeometry(p));
  });
  assert.deepEqual(geometry.map(g => [g.x, g.y, g.w, g.h]), [[0, 0, 50, 100], [50, 0, 50, 50], [50, 50, 50, 50]]);
  assert.equal(await page.evaluate(() => __test.app.tabs.length), 2);
  pass('终端正文右键直接提供向右/向下分屏，作用于右键所在终端');

  await page.evaluate(async profile => {
    const s = __test;
    for (let i = 2; i <= 4; i++) {
      const tab = await s.layout.openInPane(s.left, profile); tab.setCustomTitle(`left-${i}`);
    }
    const tab = await s.layout.openInPane(s.right, profile); tab.setCustomTitle('right-2');
    s.left.focusPane();
  }, profile);
  await page.waitForFunction(() => __test.left.tabs.every(t => t.session?.open) && __test.right.tabs.every(t => t.session?.open));
  await page.evaluate(() => {
    __test.keyBytes = [];
    for (const pane of __test.root.getAllTabs()) for (const tab of pane.tabs) {
      tab.frontend.input$.subscribe(bytes => __test.keyBytes.push(bytes.toString('hex')));
    }
  });
  for (const number of [1, 2, 3, 4]) {
    await page.keyboard.press(`Alt+${number}`);
    await page.waitForFunction(n => __test.left.active === __test.left.tabs[n - 1] && document.activeElement === __test.left.active.frontend.xterm.textarea, number);
    assert.equal(await page.evaluate(() => __test.app.activeTab === __test.root && __test.right.tabs.indexOf(__test.right.active) === 1), true);
  }
  await page.keyboard.press('Alt+9');
  await delay(100);
  assert.equal(await page.evaluate(() => __test.left.tabs.indexOf(__test.left.active)), 3);
  pass('Alt+1/2/3/4 只切换当前分屏的内部标签，其他分屏和顶部标签不变，越界编号不操作');

  // All four physical keys must focus the matching geometric neighbor.
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.right && document.activeElement === __test.right.active.frontend.xterm.textarea);
  await page.keyboard.press('Alt+1');
  await page.waitForFunction(() => __test.right.active === __test.right.tabs[0]);
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.bottom && document.activeElement === __test.bottom.active.frontend.xterm.textarea);
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await page.evaluate(() => __test.root.getFocusedTab() === __test.bottom), true);
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.right);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.left && document.activeElement === __test.left.active.frontend.xterm.textarea);
  assert.equal(await page.evaluate(() => __test.left.tabs.indexOf(__test.left.active)), 3);
  assert.deepEqual(await page.evaluate(() => __test.keyBytes), []);
  pass('Alt+上下左右按位置切换分屏焦点，保留各分屏选中标签，导航按键不进入终端输入流');

  // A name-editing modal must keep both its focus and the underlying selection.
  await page.locator('workbench-pane-tabs').first().getByRole('tab', { name: 'left-4', exact: true }).dblclick();
  const input = page.locator('rename-tab-modal input');
  await input.waitFor(); await input.focus();
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('Alt+ArrowRight');
  assert.equal(await page.evaluate(() => __test.root.getFocusedTab() === __test.left && __test.left.active === __test.left.tabs[3]), true);
  await input.press('Escape'); await input.waitFor({ state: 'detached' });
  pass('编辑标签名称时，Alt 快捷键不切换后台标签或分屏');

  await page.screenshot({ path: join(dir, 'pane-navigation.png') });
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
