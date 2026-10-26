import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchTabby, openProfile, until, visibleText } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-pane-cwd-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const directories = ["工作 子目录 'a", 'right-directory', 'explicit-profile'].map(name => {
  const path = join(workspace, name); mkdirSync(path); return realpathSync(path);
});
const [leftCwd, rightCwd, explicitCwd] = directories;
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let instance;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await openProfile(page, 'original', { type: 'local', name: 'Shell', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd: workspace } });
  async function focus(name) {
    await page.evaluate(name => {
      const s = __test, tab = s.tabs[name];
      s.app.selectTab(tab.topmostParent ?? tab);
      if (tab.parent?.select) tab.parent.select(tab); else tab.parent?.focus(tab);
    }, name);
    await page.waitForFunction(name => document.activeElement === __test.tabs[name].frontend.xterm.textarea, name);
  }
  async function verifyCwd(name, path) {
    await page.waitForFunction(name => __test.tabs[name].session?.open, name);
    await until(async () => await page.evaluate(name => __test.tabs[name].session.getWorkingDirectory(), name) === path);
    // Also run pwd in the actual shell: profile metadata alone is not proof of cwd.
    await focus(name);
    await page.keyboard.type("printf 'CWD_CHECK:%s\\n' \"$(pwd -P)\"\n");
    await until(async () => (await visibleText(page, name)).replaceAll('\n', '').includes('CWD_CHECK:' + path));
  }
  await focus('original');
  await page.keyboard.type('cd -- ' + quote(leftCwd) + '\n');
  await verifyCwd('original', leftCwd);
  await page.evaluate(() => { __test.root = __test.tabs.original.parent; });
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.app.activeTab !== __test.root && __test.app.activeTab.getFocusedTab()?.session?.open);
  await page.evaluate(() => { __test.tabs.outer = __test.app.activeTab.getFocusedTab(); });
  await verifyCwd('outer', leftCwd);
  pass('普通顶部标签在 cd 后新建终端，继承实际目录（含中文、空格、单引号）');

  await focus('original');
  await page.evaluate(async () => {
    const s = __test;
    s.layout = s.injector.get(s.plugin.PaneLayoutService);
    s.left = s.layout.enable();
    s.right = await s.layout.split(s.left, 'r');
  });
  await page.waitForFunction(() => __test.right.active?.session?.open);
  await page.evaluate(() => { __test.tabs.right = __test.right.active; });
  await verifyCwd('right', leftCwd);
  pass('新建分屏继承来源分屏的实时工作目录');

  await page.keyboard.type('cd -- ' + quote(rightCwd) + '\n');
  await verifyCwd('right', rightCwd);
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.right.tabs.length === 2 && __test.right.active.session?.open);
  await page.evaluate(() => { __test.tabs.rightNew = __test.right.active; });
  await verifyCwd('rightNew', rightCwd);
  await focus('original');
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.left.tabs.length === 2 && __test.left.active.session?.open);
  await page.evaluate(() => { __test.tabs.leftNew = __test.left.active; });
  await verifyCwd('leftNew', leftCwd);
  assert.equal(await page.evaluate(() => __test.app.tabs.length), 2);
  pass('左右分屏处于不同目录时，Ctrl+Shift+T 分别继承当前标签目录');

  await page.evaluate(async cwd => {
    __test.tabs.explicit = await __test.layout.openInPane(__test.left,
      { type: 'local', name: 'Explicit', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd } });
  }, explicitCwd);
  await verifyCwd('explicit', explicitCwd);
  pass('通过指定配置打开终端时，保留配置明确指定的工作目录');

  // Delay cwd resolution, then change focus: the new tab must retain its source.
  await focus('original');
  await page.evaluate(() => {
    const s = __test, session = s.tabs.original.session;
    s.originalGetCwd = session.getWorkingDirectory;
    const gate = new Promise(resolve => { s.releaseCwd = resolve; });
    session.getWorkingDirectory = async () => {
      const cwd = await s.originalGetCwd.call(session);
      s.cwdLookupStarted = true;
      await gate;
      return cwd;
    };
  });
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(() => __test.cwdLookupStarted);
  await focus('right');
  await page.evaluate(() => { __test.tabs.original.session.getWorkingDirectory = __test.originalGetCwd; __test.releaseCwd(); });
  await page.waitForFunction(() => __test.left.tabs.length === 4 && __test.left.active.session?.open);
  await page.evaluate(() => { __test.tabs.delayed = __test.left.active; });
  await verifyCwd('delayed', leftCwd);
  pass('读取目录期间切换分屏，不会把新终端目录串到另一个分屏');

  await focus('original');
  await page.evaluate(async () => {
    const s = __test, session = s.tabs.original.session, original = session.getWorkingDirectory;
    session.getWorkingDirectory = async () => { throw new Error('Simulated cwd lookup failure'); };
    try { s.tabs.fallback = await s.layout.openInPane(s.left); }
    finally { session.getWorkingDirectory = original; }
  });
  await verifyCwd('fallback', realpathSync(workspace));
  pass('无法读取实时目录时回退到来源终端的启动目录，仍可新建');

  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  await page.screenshot({ path: join(dir, 'cwd.png') });
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
