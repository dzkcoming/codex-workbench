import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchTabby, until, visibleText, delay } from './tabby-harness.mjs';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dir = mkdtempSync(resolve('test-results/tabby-extension-'));
const instance = await launchTabby(dir, fixture.workspace, true, true);
try {
  const result = await instance.page.evaluate(async id => {
    const service = window.__test.references;
    const reference = (await service.recent()).find(x => x.id === id);
    if (!reference) throw new Error('Reference fixture not found');
    const actions = await service.extensions[0].getActions(reference);
    actions[0].click();
    return { count: service.extensions.length, clipboard: service.platform.readClipboard() };
  }, fixture.buildID);
  assert.equal(result.count, 1);
  assert.equal(JSON.parse(result.clipboard).reference_id, fixture.buildID);
  console.log('PASS 第二个独立 Tabby 插件通过公开扩展接口读取引用元数据');
  await instance.page.evaluate(async () => {
    const state = window.__test;
    state.tabs.codex = await state.references.openCodex();
  });
  await instance.page.waitForFunction(() => window.__test.tabs.codex?.frontendIsReady);
  const screen = await until(async () => {
    const text = await visibleText(instance.page, 'codex');
    return /Codex|trust|信任/.test(text) ? text : false;
  }, 25000);
  await delay(1500);
  await instance.page.screenshot({ path: join(dir, 'codex.png') });
  writeFileSync(join(dir, 'codex-screen.txt'), screen);
  const pluginErrors = instance.errors.filter(x => !x.includes('Bad atom'));
  assert.deepEqual(pluginErrors, []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ extension_loaded: true, original_codex_started: true }, null, 2));
  console.log('PASS 插件入口成功启动原版 Codex 终端界面');
  console.log('ARTIFACTS', dir);
} catch (error) {
  await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  writeFileSync(join(dir, 'failure.txt'), String(error.stack));
  throw error;
} finally { await instance.close(); }
