import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import { launchTabby, openProfile, delay, until } from './tabby-harness.mjs';

const dir = mkdtempSync(resolve('test-results/tabby-browser-'));
const workspace = join(dir, '网页 项目'); mkdirSync(workspace);
const html = title => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{background:#17231e;color:#dae6de;font:20px sans-serif;padding:28px}input{font-size:20px}a{color:#9dceb2}</style><h1>${title}</h1><p>网页与原生终端共存</p><input id="draft" placeholder="网页草稿"><p><a id="same" href="/next">页面内跳转</a> · <a id="popup" href="/popup" target="_blank">打开新标签</a></p><script>window.keys=[];document.addEventListener('keydown',e=>keys.push(e.key));window.loads=Number(sessionStorage.loads||0)+1;sessionStorage.loads=loads;</script>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html(req.url === '/next' ? '下一页' : req.url === '/popup' ? '新网页' : '本机网页')); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const file = join(workspace, "本地 HTML '测试'.html"); writeFileSync(file, html('本地 HTML'));
const profile = { type: 'local', name: 'Shell', options: { command: '/bin/bash', args: ['--noprofile', '--norc'], cwd: workspace } };
const report = []; const pass = name => { report.push(name); console.log('PASS', name); };
let instance;
try {
  instance = await launchTabby(join(dir, 'app'), workspace);
  const { page } = instance;
  await page.evaluate(() => { const w = require('@electron/remote').getCurrentWindow(); w.unmaximize(); w.setSize(1280, 820); });
  await openProfile(page, 'original', profile);
  await page.evaluate(async () => {
    const s = __test;
    s.layout = s.injector.get(s.plugin.PaneLayoutService);
    s.left = s.layout.enable(); s.root = s.left.parent;
    s.right = await s.layout.split(s.left, 'r');
    s.session = s.tabs.original.session; s.frontend = s.tabs.original.frontend;
    s.keyBytes = []; s.tabs.original.frontend.input$.subscribe(b => s.keyBytes.push(b.toString()));
  });
  await page.waitForFunction(() => __test.right.active?.session?.open);
  await page.evaluate(() => {
    const buttons=__test.injector.get(__test.core.ToolbarButtonProvider).flatMap(p=>p.provide());
    buttons.find(b=>b.title==='打开网页 / HTML').click();
  });
  await page.waitForFunction(() => __test.right.active instanceof __test.plugin.BrowserTabComponent);
  await page.evaluate(() => {__test.web=__test.right.active;});
  await page.getByRole('textbox', {name:'网页地址'}).fill(url);
  await page.getByRole('textbox', {name:'网页地址'}).press('Enter');
  await page.waitForFunction(() => __test.web.loadError || (__test.web.viewCreated && __test.web.title === '本机网页'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => __test.web.loadError), null);
  await page.waitForFunction(() => __test.web.view?.getVisible() && !__test.web.overlayParked, null, {timeout:5000});
  const webPage = await until(() => page.context().pages().find(p => p.url() === url));
  await webPage.waitForSelector('#draft');
  assert.deepEqual(await webPage.evaluate(() => [typeof require, typeof process]), ['undefined', 'undefined']);
  assert.equal(await page.evaluate(() => __test.tabs.original.session === __test.session && __test.tabs.original.frontend === __test.frontend), true);
  pass('真实 Tabby 同时显示网页与原生终端，终端 session/frontend 保持不变，网页无 Node 权限');

  // Electron's before-input-event is upstream of CDP dispatchKeyEvent. Send through
  // WebContents.sendInputEvent to exercise that native path, not just page JS.
  const webKey = (keyCode, modifiers = []) => page.evaluate(({keyCode, modifiers}) => {
    const wc = require('@electron/remote').webContents.getFocusedWebContents();
    if (wc !== __test.web.view.webContents) throw new Error('网页尚未获得原生键盘焦点');
    wc.sendInputEvent({type:'keyDown', keyCode, modifiers});
    wc.sendInputEvent({type:'keyUp', keyCode, modifiers});
  }, {keyCode, modifiers});
  await webPage.locator('#draft').fill('保留网页草稿');
  await webKey('1', ['alt']);
  await page.waitForFunction(() => __test.right.active === __test.right.tabs[0] && !__test.web.view.getVisible(), null, {timeout:5000});
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(() => __test.right.active === __test.web && __test.web.view.getVisible());
  assert.equal(await webPage.locator('#draft').inputValue(), '保留网页草稿');
  assert.equal(await webPage.evaluate(() => keys.includes('1')), false);
  pass('网页焦点下 Alt+数字切换当前分屏标签，按键被拦截，切回网页保留表单草稿');

  await webKey('Left', ['alt']);
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.left && document.activeElement === __test.tabs.original.frontend.xterm.textarea);
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForFunction(() => __test.root.getFocusedTab() === __test.right && __test.web.view.webContents.isFocused());
  assert.deepEqual(await page.evaluate(() => __test.keyBytes), []);
  pass('网页与终端之间 Alt+方向键切换实际键盘焦点，不向终端输入快捷键');

  await webKey('T', ['control','shift']);
  await page.waitForFunction(() => __test.right.tabs.length === 3 && __test.right.active?.session?.open);
  assert.equal(await page.evaluate(() => __test.app.tabs.length), 1);
  assert.equal(await page.evaluate(() => __test.right.active.session.getWorkingDirectory()), workspace);
  pass('网页中 Ctrl+Shift+T 在当前分屏新建 Shell，继承该分屏最近终端目录');

  await page.keyboard.press('Alt+2');
  await page.waitForFunction(() => __test.web.view.webContents.isFocused());
  const handle = await page.evaluate(() => require('@electron/remote').getCurrentWindow().getNativeWindowHandle().readUInt32LE(0));
  execFileSync('import', ['-window', String(handle), join(dir, 'native-before-click.png')]);
  const webClick = async selector => {
    const point = await webPage.locator(selector).evaluate(el => { const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; });
    await page.evaluate(point => {
      const wc=__test.web.view.webContents;
      wc.sendInputEvent({type:'mouseMove',...point});
      wc.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      wc.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
    }, point);
  };
  await webClick('#same'); await webPage.waitForURL(url + 'next');
  await page.getByRole('button', { name: '后退', exact: true }).click(); await webPage.waitForURL(url);
  await page.getByRole('button', { name: '前进', exact: true }).click(); await webPage.waitForURL(url + 'next');
  await webKey('L', ['control']);
  const address = page.getByRole('textbox', { name: '网页地址', exact: true });
  await address.fill(url); await address.press('Enter'); await webPage.waitForURL(url);
  const loads = await webPage.evaluate(() => loads);
  await webKey('F5'); await webPage.waitForFunction(n => loads > n, loads);
  pass('网页地址栏、Ctrl+L、后退/前进、F5 刷新可用');

  await webClick('#popup');
  await page.waitForFunction(() => __test.right.tabs.length === 4 && __test.right.active.title === '新网页');
  assert.equal(await page.evaluate(() => __test.app.tabs.length), 1);
  pass('target=_blank 在原分屏新增网页标签，不打开额外窗口或顶部标签');

  await page.evaluate(async file => { __test.local = await __test.layout.openBrowser(__test.right, file); }, file);
  await page.waitForFunction(() => __test.local.title === '本地 HTML' && __test.local.view.getVisible());
  assert.equal(await page.evaluate(() => __test.local.url), pathToFileURL(file).href);
  pass('本地 HTML 支持中文、空格和引号路径');

  await page.locator('workbench-pane-tabs').nth(1).getByRole('tab', { name: '本地 HTML', exact: true }).dblclick();
  const rename = page.locator('rename-tab-modal input'); await rename.waitFor();
  await page.waitForFunction(() => !__test.local.view.getVisible());
  await rename.fill('报告预览'); await rename.press('Enter'); await rename.waitFor({ state: 'detached' });
  await page.waitForFunction(() => __test.local.customTitle === '报告预览' && __test.local.view.getVisible());
  pass('网页标签双击改名，原生网页层在 Tabby 弹窗期间隐藏并恢复');

  await page.evaluate(() => { __test.webWC = __test.web.view.webContents; __test.localWC = __test.local.view.webContents; });
  await page.evaluate(() => { require('@electron/remote').getCurrentWindow().setSize(1100, 700); });
  await delay(300);
  assert.equal(await page.evaluate(() => {
    const web = __test.local, b = web.view.getBounds(), r = web.host.nativeElement.getBoundingClientRect(), z = require('@electron/remote').getCurrentWebContents().getZoomFactor();
    return ['width','height','x','y'].every(k => Math.abs(b[k] - Math.round(({x:r.left,y:r.top,width:r.width,height:r.height})[k] * z)) <= 1);
  }), true);
  // OS window capture includes native child views; BrowserWindow.capturePage
  // delegates to the host webContents and omits them.
  execFileSync('import', ['-window', String(handle), join(dir, 'browser-workspace.png')]);
  pass('窗口缩放后网页区域匹配分屏内容尺寸（原生窗口合成截图已保存）');

  const spanner = page.locator('split-tab-spanner').first();
  const grip = await spanner.boundingBox();
  const oldWidth = await page.evaluate(() => __test.local.view.getBounds().width);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => !__test.local.view.getVisible());
  await page.mouse.move(grip.x + 90, grip.y + grip.height / 2, {steps:8});
  await page.mouse.up();
  await page.waitForFunction(w => __test.local.view.getVisible() && __test.local.view.getBounds().width < w - 40, oldWidth);
  pass('鼠标拖动分隔线时网页暂时隐藏，释放后恢复并匹配新分屏尺寸');

  await page.evaluate(() => { __test.right.select(__test.web); __test.web.addressBarValue='http://127.0.0.1:1/'; __test.web.navigate(); });
  await page.waitForFunction(() => !!__test.web.loadError && !__test.web.view.getVisible());
  await page.getByRole('textbox', {name:'网页地址'}).filter({visible:true}).fill(url);
  await page.getByRole('textbox', {name:'网页地址'}).filter({visible:true}).press('Enter');
  await page.waitForFunction(() => !__test.web.loadError && __test.web.view.getVisible());
  await page.evaluate(() => __test.right.select(__test.local));
  pass('加载失败显示可恢复错误，地址栏可以重新打开有效网页');

  const token = await page.evaluate(() => __test.injector.get(__test.core.TabRecoveryService).getFullRecoveryToken(__test.root));
  await page.evaluate(async token => {
    const s=__test; const params = await s.injector.get(s.core.TabRecoveryService).recoverTab(token);
    s.restored = await s.app.openNewTab(params);
  }, token);
  await page.waitForFunction(() => {
    const root=__test.app.activeTab;
    return root !== __test.root && root.getAllTabs().length === 2 && root.getAllTabs()[1].tabs?.length === 5 && root.getAllTabs()[1].active?.customTitle === '报告预览';
  });
  await page.waitForFunction(() => !__test.web.view.getVisible() && !__test.local.view.getVisible() && __test.local.boundsWatch === 0);
  pass('混合分屏完整恢复网页 URL、自定义名称和选中标签，切换顶部标签隐藏旧网页并停止布局轮询');
  await page.evaluate(async () => { await __test.right.closeTab(__test.local); await __test.right.closeTab(__test.web); });
  assert.equal(await page.evaluate(() => __test.webWC.isDestroyed() && __test.localWC.isDestroyed()), true);
  pass('关闭网页销毁独立 WebContents，原终端会话继续运行');
  await page.evaluate(async path => {
    const r=require('@electron/remote');
    const owner=new r.BrowserWindow({show:false});
    await owner.loadURL('about:blank');
    const host=r.getGlobal('process').getBuiltinModule('module').createRequire(path)(path);
    const view=host.createBrowserView(owner);
    owner.contentView.addChildView(view);
    __test.orphanWC=view.webContents;
    if (__test.orphanWC.isDestroyed()) throw new Error('网页提前关闭');
    owner.destroy();
  }, resolve('tabby/dist/browser-host.cjs'));
  await page.waitForFunction(() => __test.orphanWC.isDestroyed());
  pass('宿主窗口关闭时主进程清理网页 WebContents，避免依赖 renderer 析构');
  assert.deepEqual(instance.errors.filter(x => !x.includes('Bad atom')), []);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('ARTIFACTS', dir);
} catch (error) {
  console.error('ARTIFACTS', dir);
  if (instance) {
    console.error('RENDERER_ERRORS', instance.errors);
    console.error('STATE', await instance.page.evaluate(() => ({ title: __test.web?.title, error: __test.web?.loadError, pages: __test.app.tabs.length, visible: __test.web?.visible, parked: __test.web?.overlayParked })).catch(() => null));
    await instance.page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (instance) await instance.close();
  await new Promise(r => server.close(r));
  if (instance) assert.doesNotMatch(readFileSync(join(dir, 'app/app.log'), 'utf8'), /(?:uncaughtException|unhandledRejection):[^\n]*\n[^\n]*browser-host/);
}
