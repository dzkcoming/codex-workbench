import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, symlinkSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import net from 'node:net';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('Timed out waiting for Tabby state');
}
export async function launchTabby(directory, workspace, plugin = true, extension = false) {
  const root = process.cwd();
  mkdirSync(directory, { recursive: true });
  const config = join(directory, 'config'); mkdirSync(config, { recursive: true });
  const plugins = join(directory, 'plugins'); mkdirSync(plugins, { recursive: true });
  if (plugin) symlinkSync(join(root, 'tabby'), join(plugins, 'tabby-codex-references'));
  if (extension) symlinkSync(join(root, 'tabby/examples/source-label'), join(plugins, 'tabby-reference-source'));
  writeFileSync(join(config, 'config.yaml'), `version: 7\nenableWelcomeTab: false\nenableAnalytics: false\nhotkeys:\n  toggle-window: []\n  rearrange-panes: []\ncodexReferences:\n  enabled: true\n  workspace: ${JSON.stringify(workspace)}\nterminal:\n  rightClick: menu\n`);
  const env = { ...process.env, TABBY_CONFIG_DIRECTORY: config, TABBY_PLUGINS: plugins,
    XDG_CONFIG_HOME: join(directory, 'xdg-config'), XDG_CACHE_HOME: join(directory, 'xdg-cache'),
    TABBY_CODEX_LAUNCHER: join(root, 'scripts/codex-with-references.py') };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.TABBY_TEST_DESKTOP_AUTH === '1') { delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; }
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const logfile = openSync(join(directory, 'app.log'), 'a');
  const processHandle = spawn(join(root, '.runtime/tabby-app/opt/Tabby/tabby'),
    [...(env.XDG_SESSION_TYPE === 'x11' ? ['--ozone-platform=x11'] : []), '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port, '--user-data-dir=' + join(directory, 'userdata')],
    { env, stdio: ['ignore', logfile, logfile], detached: true });
  closeSync(logfile);
  let browser;
  async function close() {
    // Only terminate this isolated test process group, including fixture terminal processes.
    try { process.kill(-processHandle.pid, 'SIGTERM'); } catch {}
    if (browser) await Promise.race([browser.close().catch(() => {}), delay(2000)]);
    await delay(300);
    try { process.kill(-processHandle.pid, 'SIGKILL'); } catch {}
  }
  try {
    await until(async () => {
      if (processHandle.exitCode !== null || processHandle.signalCode !== null) throw new Error('Test Tabby exited before starting DevTools; see app.log');
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
    }, 60000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.pluginModules?.length && document.querySelector('app-root'));
    await page.evaluate(({ plugin, packagePath }) => {
      const core = require('tabby-core');
      const injector = require('@angular/core').getDebugNode(document.querySelector('app-root')).injector;
      window.__test = { core, injector, app: injector.get(core.AppService), tabs: {} };
      if (plugin) {
        window.__test.plugin = require(packagePath);
        window.__test.references = injector.get(window.__test.plugin.ReferencesService);
      }
    }, { plugin, packagePath: resolve('tabby') });
    await page.waitForFunction(() => !!window.__test.injector.get(window.__test.core.ConfigService).store?.profiles);
    if (await page.evaluate(() => !!window.safeModeReason)) throw new Error('Tabby entered safe mode');
    return { page, errors, close, process: processHandle };
  } catch (error) { await close(); throw error; }
}

export async function openProfile(page, name, profile) {
  await page.evaluate(async ({ name, profile }) => {
    const state = window.__test;
    state.tabs[name] = await state.injector.get(state.core.ProfilesService).openNewTabForProfile(profile);
    state.tabs[name].setCustomTitle(name);
  }, { name, profile });
  await page.waitForFunction(name => window.__test.tabs[name]?.frontendIsReady && window.__test.tabs[name]?.session?.open, name);
}

export async function visibleText(page, name) {
  return page.evaluate(name => {
    const buffer = window.__test.tabs[name].frontend.xterm.buffer.active;
    return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) || '').join('\n');
  }, name);
}

export async function selectText(page, name, text) {
  await until(async () => (await visibleText(page, name)).includes(text));
  return page.evaluate(({ name, text }) => {
    const tab = window.__test.tabs[name];
    window.__test.app.selectTab(tab.topmostParent ?? tab); tab.parent?.select?.(tab); tab.parent?.focus?.(tab); tab.emitFocused(); tab.frontend.focus();
    const term = tab.frontend.xterm; const buffer = term.buffer.active;
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row).translateToString(true); const column = line.indexOf(text);
      if (column >= 0) { term.select(column, row, text.length); return term.getSelection(); }
    }
    throw new Error('Fixture text not found');
  }, { name, text });
}

export async function measureEcho(page, name, count = 30) {
  await page.evaluate(name => {
    const state = window.__test; const tab = state.tabs[name];
    state.app.selectTab(tab.topmostParent ?? tab); tab.parent?.select?.(tab); tab.parent?.focus?.(tab); tab.emitFocused(); tab.frontend.clearSelection();
  }, name);
  await page.waitForFunction(name => !!window.__test.tabs[name].frontend.xterm.textarea.offsetParent, name);
  await page.evaluate(name => window.__test.tabs[name].frontend.xterm.textarea.focus(), name);
  await page.waitForFunction(name => document.activeElement === window.__test.tabs[name].frontend.xterm.textarea, name);
  await page.evaluate(name => {
    const state = window.__test; const tab = state.tabs[name];
    state.app.selectTab(tab.topmostParent ?? tab); tab.parent?.select?.(tab); tab.parent?.focus?.(tab); tab.emitFocused(); tab.frontend.focus();
    state.measure = { started: null, samples: [] };
    state.measure.keydown = event => { if (event.key === 'q') state.measure.started = performance.now(); };
    document.addEventListener('keydown', state.measure.keydown, true);
    state.measure.subscription = tab.session.binaryOutput$.subscribe(data => {
      if (state.measure.started !== null && data.toString().includes('q')) {
        state.measure.samples.push(performance.now() - state.measure.started); state.measure.started = null;
      }
    });
  }, name);
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('q');
    await until(() => page.evaluate(n => window.__test.measure.samples.length > n, i), 4000);
    await delay(20);
  }
  return page.evaluate(() => {
    const data = window.__test.measure; document.removeEventListener('keydown', data.keydown, true); data.subscription.unsubscribe();
    const samples = data.samples.sort((a, b) => a - b);
    return { samples, median: samples[Math.floor(samples.length / 2)], p95: samples[Math.ceil(samples.length * .95) - 1], max: samples.at(-1) };
  });
}
