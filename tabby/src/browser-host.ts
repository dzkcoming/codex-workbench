// Loaded ONLY in Electron's main process through its Node createRequire API.
// Cancellable Electron events must run synchronously here, not in remote callbacks.
import { browserShortcut, type BrowserShortcut, type BrowserInput } from './browser-utils';
const { WebContentsView, session, app } = require('electron');
const bindings = new WeakMap<object, BrowserShortcut[]>();
let browserSession: any;

export function createBrowserView(owner: any) {
  if (!browserSession) {
    browserSession = session.fromPartition('persist:codex-workbench-browser');
    browserSession.setPermissionRequestHandler((_wc: unknown, _permission: string, callback: (allow: boolean) => void) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    // Downloads need their own UI; never silently save a page-triggered download.
    browserSession.on('will-download', (event: { preventDefault(): void }) => event.preventDefault());
  }
  const view = new WebContentsView({ webPreferences: {
    nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true,
    // Tabby's Linux host starts with --no-sandbox. Forcing a sandboxed child in
    // that host leaves its compositor blank (verified on Tabby 1.0.238).
    // Match the host mode; never grant page JS Node or remote access.
    sandbox: !app.commandLine.hasSwitch('no-sandbox'), webSecurity: true, session: browserSession,
  } });
  view.setVisible(false);
  const wc = view.webContents;
  const ownerContents = owner.webContents;
  // Native views are not automatically disposed when a window/host renderer dies.
  const close = () => { if (!wc.isDestroyed()) wc.close(); };
  owner.once('closed', close);
  ownerContents.once('destroyed', close);
  ownerContents.once('render-process-gone', close);
  ownerContents.once('did-start-loading', close);
  wc.once('destroyed', () => {
    owner.removeListener('closed', close);
    // Accessing owner.webContents after native window destruction throws.
    for (const event of ['destroyed', 'render-process-gone', 'did-start-loading']) ownerContents.removeListener(event, close);
  });
  const allowed = (value: string) => {
    try {
      const protocol = new URL(value).protocol;
      return ['http:', 'https:'].includes(protocol) || (protocol === 'file:' && wc.getURL().startsWith('file:'));
    } catch { return false; }
  };
  wc.on('will-navigate', (event: { preventDefault(): void }, url: string) => { if (!allowed(url)) event.preventDefault(); });
  wc.on('will-redirect', (event: { preventDefault(): void }, url: string) => { if (!allowed(url)) event.preventDefault(); });
  wc.setWindowOpenHandler(({ url }: { url: string }) => {
    if (allowed(url)) wc.emit('workbench-open-url', url);
    return { action: 'deny' };
  });
  const consumed = new Set<string>();
  wc.on('before-input-event', (event: { preventDefault(): void }, input: BrowserInput) => {
    if (input.type === 'keyUp') {
      if (consumed.delete(input.code)) event.preventDefault();
      return;
    }
    if (input.type !== 'keyDown') return;
    const id = browserShortcut(input, bindings.get(view) ?? []);
    if (!id) return;
    event.preventDefault();
    consumed.add(input.code);
    if (!input.isAutoRepeat) wc.emit('workbench-shortcut', id);
  });
  return view;
}

export function setBrowserShortcuts(view: object, shortcuts: BrowserShortcut[]) {
  bindings.set(view, shortcuts);
}
