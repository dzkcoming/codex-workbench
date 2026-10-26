import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchTabby, openProfile, selectText, visibleText, until } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-context-menu-'));
const workspace = join(dir, 'project'); mkdirSync(workspace);
const report = [];
const pass = name => { report.push(name); console.log('PASS', name); };
let instance;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  const program = 'import os,tty\nprint("COPY_ME_9328",flush=True)\ntty.setraw(0)\nwhile True:\n b=os.read(0,4096)\n if not b: break\n os.write(1,b)';
  await openProfile(page, 'source', { type: 'local', name: 'source', options: { command: '/usr/bin/python3', args: ['-u', '-c', program], cwd: workspace } });
  const expected = await page.evaluate(() => {
    const s = __test;
    s.basket = s.injector.get(s.plugin.ReferenceBasketService);
    const translate = s.injector.get(s.core.TranslateService);
    s.copyLabel = translate.instant('Copy'); s.pasteLabel = translate.instant('Paste');
    return [s.copyLabel, s.pasteLabel, '向右分屏', '向下分屏', '引用到 Codex'];
  });
  // Exercise the actual terminal DOM event; capture only the final OS popup boundary.
  await page.evaluate(() => {
    const s = __test; s.platform = s.injector.get(s.core.PlatformService);
    s.popupOriginal = s.platform.popupContextMenu;
    s.platform.popupContextMenu = menu => { s.popup = menu; };
  });
  await page.locator('.xterm-screen').first().click({ button: 'right' });
  await page.waitForFunction(() => !!__test.popup);
  const empty = await page.evaluate(() => {
    const menu = __test.popup;
    __test.platform.popupContextMenu = __test.popupOriginal;
    return { labels: menu.filter(x => x.label).map(x => x.label), enabled: menu.filter(x => x.label).map(x => x.enabled), types: menu.map(x => x.type || 'item') };
  });
  assert.deepEqual(empty.labels, expected);
  assert.equal(empty.enabled[0], false); assert.equal(empty.enabled[4], false);
  assert.deepEqual(empty.types, ['item', 'item', 'separator', 'item', 'item', 'separator', 'item']);
  pass('实际正文右键只显示五项，无选区时复制和引用到 Codex 禁用');

  await selectText(page, 'source', 'COPY_ME_9328');
  await page.evaluate(async () => {
    __test.menu = await __test.tabs.source.buildContextMenu();
    __test.menu.find(x => x.label === __test.copyLabel).click();
  });
  await until(() => page.evaluate(() => __test.platform.readClipboard() === 'COPY_ME_9328'));
  await page.evaluate(async () => {
    __test.tabs.source.frontend.clearSelection();
    __test.platform.setClipboard({ text: 'PASTE_ME_6214' });
    await __test.menu.find(x => x.label === __test.pasteLabel).click();
  });
  await until(async () => (await visibleText(page, 'source')).includes('PASTE_ME_6214'));
  pass('保留真实选区复制和原生粘贴，粘贴内容到达原终端');

  // The menu captured the old selection before it was cleared above.
  await page.evaluate(() => __test.menu.find(x => x.label === '引用到 Codex').click());
  await until(() => page.evaluate(() => __test.platform.readClipboard().includes('COPY_ME_9328')));
  const reference = await page.evaluate(async () => {
    const references = await __test.references.recent();
    return __test.basket.read(__test.references.workspace, references[0].id);
  });
  assert.equal(reference.text, 'COPY_ME_9328'); assert.equal(reference.source.name, 'source');
  const headers = await page.evaluate(async () => {
    const header = require('@angular/core').getDebugNode(document.querySelector('tab-header')).componentInstance;
    const items = await header.buildContextMenu();
    return { labels: items.filter(x => x.label).map(x => x.label), save: __test.injector.get(__test.core.TranslateService).instant('Save as profile') };
  });
  assert.ok(headers.labels.includes(headers.save)); assert.ok(headers.labels.includes('Codex 引用'));
  pass('没有 Codex 目标时复制菜单打开时的选区，原生标签栏菜单仍保留配置与引用入口');

  await page.evaluate(() => {
    __test.sourceSession = __test.tabs.source.session;
    __test.root = __test.tabs.source.topmostParent;
    __test.menu.find(x => x.label === '向右分屏').click();
  });
  await page.waitForFunction(() => __test.root.getAllTabs().length === 2 && __test.root.getAllTabs().every(p => p.active?.session?.open));
  const paneLabels = await page.evaluate(async () => (await __test.tabs.source.buildContextMenu()).filter(x => x.label).map(x => x.label));
  assert.deepEqual(paneLabels, expected);
  await page.evaluate(async () => (await __test.tabs.source.buildContextMenu()).find(x => x.label === '向下分屏').click());
  await page.waitForFunction(() => __test.root.getAllTabs().length === 3 && __test.root.getAllTabs().every(p => p.active?.session?.open));
  assert.equal(await page.evaluate(() => __test.tabs.source.session === __test.sourceSession && __test.sourceSession.open), true);
  pass('精简菜单的两个分屏动作可用，分屏后仍是五项，原终端会话保持');
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  console.error('ARTIFACTS', dir);
  writeFileSync(join(dir, 'failure.txt'), String(error.stack));
  if (instance) { console.error(instance.errors); await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {}); }
  throw error;
} finally { if (instance) await instance.close(); }
