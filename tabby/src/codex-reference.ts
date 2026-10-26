import { Inject, Injectable, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppService, BaseTabComponent, HotkeysService, NotificationsService, PlatformService, SelectorService, SplitTabComponent } from 'tabby-core';
import { BaseTerminalTabComponent } from 'tabby-terminal';
import { PaneTabsComponent } from './pane-tabs';
import { BasketSource, type CapturedSelection } from './reference-basket';
import { ReferenceBridge } from './bridge';
import { composerReady, directReferencePrompt, pastePacket, type CodexProcess } from './codex-target';
import type { ReferenceSummary } from './references';

type Terminal = BaseTerminalTabComponent<any>;
interface Candidate { pane: BaseTabComponent; tab: Terminal; session: Terminal['session']; }
export interface ReferenceIntent {
  root: SplitTabComponent | null; source: Terminal; candidates: Candidate[]; receiver?: BaseTabComponent;
  selection: CapturedSelection; workspace: string;
}

@Injectable()
export class CodexReferenceService {
  private receivers = new WeakMap<SplitTabComponent, BaseTabComponent>();
  private bridge = new ReferenceBridge();
  private subscription: Subscription;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(@Inject(BasketSource) private source: BasketSource, @Inject(AppService) private app: AppService,
    @Inject(HotkeysService) hotkeys: HotkeysService, @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(PlatformService) private platform: PlatformService, @Inject(SelectorService) private selector: SelectorService,
    @Inject(NgZone) private zone: NgZone) {
    this.subscription = hotkeys.hotkey$.subscribe(key => {
      if (key !== 'reference-basket-add') return;
      const editing = document.activeElement;
      if (editing?.matches('input,textarea,[contenteditable="true"]') && !editing.closest('.xterm')) return;
      void this.run(async () => {
        let tab = this.app.activeTab;
        while (tab instanceof SplitTabComponent || tab instanceof PaneTabsComponent) tab = tab instanceof SplitTabComponent ? tab.getFocusedTab() : tab.active;
        if (!(tab instanceof BaseTerminalTabComponent)) throw new Error('请先选中来源终端的内容');
        await this.send(this.capture(tab, this.source.captureActive()));
      });
    });
  }
  async run(action: () => Promise<unknown>) {
    try { return await action(); } catch (e) { this.zone.run(() => this.notifications.error('引用到 Codex', String(e))); }
  }
  capture(source: Terminal, selection: CapturedSelection, workspace = this.source.workspace): ReferenceIntent {
    const top = source.topmostParent;
    const root = top instanceof SplitTabComponent ? top : null;
    const candidates: Candidate[] = [];
    for (const pane of root?.getAllTabs() ?? []) {
      const tab = pane instanceof PaneTabsComponent ? pane.active : pane;
      if (tab instanceof BaseTerminalTabComponent && tab !== source) candidates.push({ pane, tab, session: tab.session });
    }
    return { root, source, candidates, receiver: root ? this.receivers.get(root) : undefined,
      selection: { text: selection.text, source: { ...selection.source } }, workspace };
  }
  private title(tab: BaseTabComponent) { return (tab as any).displayTitle || tab.customTitle || tab.title || '终端'; }
  private current(intent: ReferenceIntent, candidate: Candidate) {
    return !!intent.root && this.app.activeTab === intent.root && this.app.tabs.includes(intent.root)
      && intent.root.getAllTabs().includes(candidate.pane) && candidate.tab.session === candidate.session && !!candidate.session?.open
      && (candidate.pane instanceof PaneTabsComponent ? !candidate.pane.disposed && candidate.pane.active === candidate.tab : candidate.pane === candidate.tab);
  }
  private async probe(candidate: Candidate): Promise<CodexProcess | null> {
    if (candidate.tab.profile?.type !== 'local' || !candidate.session?.open) return null;
    // Host 1.0.238 exposes the native PTY proxy on local sessions. Unsupported
    // hosts/SSH/tmux are deliberately not guessed from names or output text.
    const proxy = (candidate.session as any).pty;
    if (typeof proxy?.getPID !== 'function') return null;
    const pid = await proxy.getPID();
    return this.bridge.request<CodexProcess | null>('', 'codex-probe', { root_pid: Number(pid) });
  }
  private ready(tab: Terminal) {
    const term = (tab.frontend as any)?.xterm;
    if (!term || document.querySelector('ngb-modal-window')) return false;
    const buffer = term.buffer.active;
    const lines = Array.from({ length: term.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) || '');
    const hidden = (term._core?.coreService ?? term._core?._coreService)?.isCursorHidden;
    return composerReady(lines, buffer.cursorY, hidden === false, !!tab.frontend?.supportsBracketedPaste());
  }
  private async waitReady(intent: ReferenceIntent, candidate: Candidate) {
    // Resize/focus redraws briefly clear a TUI. Allow a short settling interval
    // for this explicit action only; never wait indefinitely for a menu to close.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!this.current(intent, candidate)) return false;
      if (this.ready(candidate.tab)) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  }
  private async pick(intent: ReferenceIntent, force = false): Promise<{ candidate: Candidate; process: CodexProcess } | null> {
    if (!intent.root || this.app.activeTab !== intent.root) throw new Error('请在包含 Codex 分屏的当前调试页中引用');
    let candidates = intent.candidates;
    if (intent.receiver && !force) {
      candidates = candidates.filter(c => c.pane === intent.receiver);
      if (!candidates.length) {
        if (!intent.root.getAllTabs().includes(intent.receiver)) this.receivers.delete(intent.root);
        throw new Error('接收分屏已关闭或未显示终端，请切回 Codex 或重新选择接收分屏');
      }
    }
    const valid: { candidate: Candidate; process: CodexProcess }[] = [];
    for (const candidate of candidates) {
      if (!this.current(intent, candidate)) continue;
      const process = await this.probe(candidate);
      if (process) valid.push({ candidate, process });
    }
    if (!valid.length) throw new Error('接收分屏没有可识别的本机 Codex');
    let selected = valid[0];
    if (valid.length > 1) {
      const choice = await this.zone.run(() => this.selector.show('选择接收引用的 Codex 分屏', valid.map((value, i) => ({ name: `${i + 1} · ${this.title(value.candidate.tab)}`,
        description: '以后跟随这个分屏当前显示的 Codex 标签', result: value })))).catch(() => null);
      if (!choice) return null;
      selected = choice;
      // NgbModal resolves before its closing animation removes the overlay.
      const deadline = Date.now() + 1500;
      while (document.querySelector('ngb-modal-window') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!this.current(intent, selected.candidate)) throw new Error('目标标签已切换，请重新引用');
    this.receivers.set(intent.root, selected.candidate.pane);
    return selected;
  }
  async chooseReceiver(source: Terminal) {
    const intent = this.capture(source, { text: '', source: { terminal_id: '', session_id: '', name: '', kind: '', captured_at: '' } });
    const pane = source.parent instanceof PaneTabsComponent ? source.parent : source;
    if (intent.root?.getAllTabs().includes(pane)) intent.candidates.push({ pane, tab: source, session: source.session });
    const selected = await this.pick(intent, true);
    if (selected) this.zone.run(() => this.notifications.notice(`引用接收分屏：${this.title(selected.candidate.tab)}`));
  }
  send(intent: ReferenceIntent) {
    if (!this.source.enabled) return Promise.reject(new Error('终端引用功能已停用'));
    if (this.pending >= 8) return Promise.reject(new Error('引用正在处理，请稍后再添加'));
    this.pending++;
    const result = this.queue.then(() => this.deliver(intent));
    this.queue = result.catch(() => {}).finally(() => { this.pending--; });
    return result;
  }
  private async deliver(intent: ReferenceIntent) {
    let target: Awaited<ReturnType<CodexReferenceService['pick']>> = null;
    let failure: unknown;
    try { target = await this.pick(intent); if (!target) return; } catch (e) { failure = e; }
    const workspace = intent.workspace || await this.source.requireWorkspace();
    const saved = await this.bridge.request<{ reference: ReferenceSummary; prompt: string }>(workspace, 'create', { ...intent.selection });
    saved.prompt = directReferencePrompt(saved.reference, intent.selection.text);
    try {
      if (!target) throw failure;
      const { candidate } = target;
      if (!await this.waitReady(intent, candidate)) throw new Error('Codex 当前不是可确认的普通输入界面，请退出菜单或等待任务结束后粘贴');
      const check = await this.probe(candidate);
      if (!check || check.identity !== target.process.identity || !this.current(intent, candidate) || !this.ready(candidate.tab)) {
        throw new Error('目标会话或输入状态已改变，本次未投递');
      }
      candidate.tab.sendInput(pastePacket(saved.prompt));
      this.zone.run(() => this.notifications.notice(`已放入「${this.title(candidate.tab)}」的 Codex 草稿，未发送`));
      return saved.reference;
    } catch (e) {
      this.platform.setClipboard({ text: saved.prompt });
      const reason = e instanceof Error ? e.message : String(e);
      this.zone.run(() => this.notifications.info(`${reason}。引用已复制，可手动粘贴。`, '未直接投递'));
      return undefined;
    }
  }
  ngOnDestroy() { this.subscription.unsubscribe(); this.bridge.close(); }
}
