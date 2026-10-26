import {
  Component, ElementRef, Inject, Injectable, Injector, ViewChild, ViewContainerRef,
} from '@angular/core';
import { Subscription, take } from 'rxjs';
import { resolve } from 'node:path';
import {
  AppService, BaseTabComponent, ConfigProvider, ConfigService, HotkeyProvider, HotkeysService,
  NotificationsService, PlatformService, ProfilesService, SplitTabComponent, TabContextMenuItemProvider,
  TabRecoveryProvider, TabRecoveryService, TabsService, ToolbarButtonProvider,
  type GetRecoveryTokenOptions, type MenuItemOptions, type PartialProfile, type Profile, type RecoveryToken,
} from 'tabby-core';
import { BaseTerminalTabComponent } from 'tabby-terminal';
import { BrowserTabComponent } from './browser-tab';
import { browserURL } from './browser-utils';

const TOKEN_TYPE = 'codex-workbench:pane-tabs';
type TerminalProfile = PartialProfile<Profile>;
const FOCUS_DIRECTIONS = { left: 'l', right: 'r', up: 't', down: 'b' } as const;

/** A split leaf owns several native tabs. Switching changes visibility, never the session. */
@Component({
  selector: 'workbench-pane-tabs',
  template: `
    <div class="pane-header" (click)="$event.stopPropagation()">
      <div #tabStrip class="pane-tabs" role="tablist" aria-label="分屏内标签" (keydown)="navigateTabs($event)">
        <div *ngFor="let tab of tabs" class="pane-tab" [class.selected]="tab === active">
          <button class="pane-tab-select" role="tab" [attr.aria-selected]="tab === active"
            [attr.tabindex]="tab === active ? 0 : -1" [title]="titleOf(tab) + '（双击重命名）'" [attr.aria-label]="titleOf(tab)"
            (click)="select(tab)" (dblclick)="rename(tab, $event)" (contextmenu)="tabMenu($event, tab)">
            <span *ngIf="tab.hasActivity && tab !== active" class="activity" aria-label="有新输出">●</span>{{titleOf(tab)}}
          </button>
          <button class="pane-tab-close" [attr.aria-label]="'关闭 ' + titleOf(tab)" title="关闭此标签"
            (click)="runClose(tab)">×</button>
        </div>
      </div>
      <button class="pane-action" title="在此分屏新建 Shell" aria-label="在此分屏新建 Shell" (click)="newShell()">＋</button>
      <button class="pane-action" title="分屏与终端菜单" aria-label="分屏与终端菜单" (click)="menu()">⋯</button>
    </div>
    <div class="pane-body" (pointerdown)="focusPane()" (focusin)="onTerminalFocus()"><ng-container #contents></ng-container></div>
  `,
  styles: [`
    :host{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
    .pane-header{display:flex;flex:0 0 32px;min-width:0;background:var(--theme-bg-more,#20252b);border-bottom:1px solid #8884}
    .pane-tabs{display:flex;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin}
    .pane-tab{display:flex;flex:none;max-width:200px;min-width:64px;border-right:1px solid #8883;border-bottom:2px solid transparent}
    .pane-tab.selected{background:#8882;border-bottom-color:var(--theme-primary,#91bfa7)}
    button{color:inherit;background:transparent;border:0;padding:3px 7px;font:inherit;font-size:12px;cursor:pointer}
    button:hover{background:#8883}button:focus-visible{outline:1px solid currentColor;outline-offset:-2px}
    .pane-tab-select{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;text-align:left}
    .pane-tab-close{opacity:.65;padding:2px 6px}.pane-action{flex:none;width:29px;font-size:18px}
    .activity{font-size:9px;padding-right:5px}.pane-body{position:relative;flex:1;min-height:0;min-width:0}
  `],
})
export class PaneTabsComponent extends BaseTabComponent {
  @ViewChild('contents', { read: ViewContainerRef, static: true }) contents!: ViewContainerRef;
  @ViewChild('tabStrip', { read: ElementRef, static: true }) tabStrip!: ElementRef<HTMLElement>;
  tabs: BaseTabComponent[] = [];
  active: BaseTabComponent | null = null;
  lastTerminal: BaseTerminalTabComponent<any> | null = null;
  initialTabs: BaseTabComponent[] = [];
  recoveredState?: RecoveryToken;
  disposed = false;
  private initialized = false;
  private subscriptions = new Map<BaseTabComponent, Subscription>();
  private elements = new Map<BaseTabComponent, HTMLElement>();
  private closing = new Set<BaseTabComponent>();
  get icon(): string | null { return this.active?.icon ?? super.icon; }
  set icon(value: string | null) { super.icon = value; }
  get color(): string | null { return this.active?.color ?? super.color; }
  set color(value: string | null) { super.color = value; }

  constructor(@Inject(Injector) private injector: Injector) {
    super(injector);
    this.setTitle('终端');
    this.focused$.subscribe(() => this.focusActive());
    this.blurred$.subscribe(() => this.tabs.forEach(tab => tab.emitBlurred()));
    this.visibility$.subscribe(visible => { this.updateVisibility(); if (visible && this.hasFocus) this.focusActive(); });
  }
  private get layout() { return this.injector.get(PaneLayoutService); }
  titleOf(tab: BaseTabComponent) {
    return (tab as BaseTabComponent & { displayTitle?: string }).displayTitle || tab.customTitle || tab.title || '终端';
  }
  async ngAfterViewInit() {
    this.initialized = true;
    for (const tab of this.initialTabs) this.addTab(tab);
    this.initialTabs = [];
    if (this.recoveredState) {
      const recovery = this.injector.get(TabRecoveryService);
      const restored: (BaseTabComponent | null)[] = [];
      for (const token of this.recoveredState.children ?? []) {
        if (this.disposed) return;
        const params = await recovery.recoverTab(token);
        if (this.disposed) return;
        const tab = params ? this.injector.get(TabsService).create(params) : null;
        restored.push(tab);
        if (tab) this.addTab(tab);
        else this.injector.get(NotificationsService).error('分屏恢复', '一个终端无法恢复，请检查对应插件或连接配置。');
      }
      const selected = restored[this.recoveredState.activeIndex] ?? this.tabs[0];
      if (selected) this.select(selected, false);
    }
    if (this.parent instanceof SplitTabComponent) this.layout.watch(this.parent);
    this.updateVisibility();
  }
  addTab(tab: BaseTabComponent) {
    if (this.disposed) throw new Error('分屏已关闭');
    if (!this.initialized) { this.initialTabs.push(tab); return; }
    if (this.tabs.includes(tab)) return;
    tab.removeFromContainer();
    tab.parent = this;
    this.tabs.push(tab);
    if (tab instanceof BrowserTabComponent) this.layout.bindBrowser(this, tab);
    const element = tab.insertIntoContainer(this.contents).rootNodes[0] as HTMLElement;
    element.classList.remove('child', 'focused', 'minimized', 'maximized');
    Object.assign(element.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
    this.elements.set(tab, element);
    const subscriptions = new Subscription();
    this.subscriptions.set(tab, subscriptions);
    subscriptions.add(tab.destroyed$.subscribe(() => this.removeTab(tab)));
    subscriptions.add(tab.titleChange$.subscribe(() => this.updateTitle()));
    subscriptions.add(tab.activity$.subscribe(() => {
      if (this.tabs.some(t => t.hasActivity)) this.displayActivity(); else super.clearActivity();
    }));
    subscriptions.add(tab.progress$.subscribe(p => { if (tab === this.active) this.setProgress(p); }));
    subscriptions.add(tab.recoveryStateChangedHint$.subscribe(() => this.recoveryStateChangedHint.next()));
    this.select(tab, false);
    // Native terminal frontends attach on their first focus. Prime restored background
    // tabs once, with their host inert, so all sessions start without stealing focus.
    tab.hostView.detectChanges();
    if (tab instanceof BaseTerminalTabComponent && !tab.frontendIsReady) {
      subscriptions.add(tab.frontendReady$.subscribe(() => this.updateVisibility()));
      setImmediate(() => {
        if (this.disposed || !this.tabs.includes(tab)) return;
        tab.emitFocused();
        if (this.active !== tab || !this.hasFocus) tab.emitBlurred();
      });
    }
    this.recoveryStateChangedHint.next();
  }
  private removeTab(tab: BaseTabComponent) {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    this.subscriptions.get(tab)?.unsubscribe();
    this.subscriptions.delete(tab);
    tab.removeFromContainer();
    tab.parent = null;
    this.elements.delete(tab);
    this.tabs.splice(index, 1);
    if (this.lastTerminal === tab) this.lastTerminal = this.tabs.find(t => t instanceof BaseTerminalTabComponent) as BaseTerminalTabComponent<any> ?? null;
    if (this.active === tab) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    if (!this.disposed) {
      if (!this.tabs.length) this.destroy();
      else if (this.active) this.select(this.active, this.hasFocus);
    }
    this.recoveryStateChangedHint.next();
  }
  select(tab: BaseTabComponent, focus = true) {
    if (!this.tabs.includes(tab) || this.disposed) return;
    for (const other of this.tabs) if (other !== tab) other.emitBlurred();
    this.active = tab;
    if (tab instanceof BaseTerminalTabComponent) this.lastTerminal = tab;
    this.updateVisibility();
    this.updateTitle();
    this.setProgress(null);
    tab.clearActivity();
    requestAnimationFrame(() => {
      if (!this.disposed && this.visibility.value) {
        this.tabStrip?.nativeElement.querySelector('.pane-tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    this.recoveryStateChangedHint.next();
    if (focus) this.focusPane();
    else if (this.hasFocus) this.focusActive();
  }
  focusPane() {
    if (this.disposed) return;
    const app = this.injector.get(AppService);
    const top = this.topmostParent ?? this;
    if (app.activeTab !== top) app.selectTab(top);
    if (this.parent instanceof SplitTabComponent) {
      if (this.parent.getFocusedTab() !== this || !this.hasFocus) this.parent.focus(this);
      else this.focusActive();
    } else this.emitFocused();
  }
  onTerminalFocus() {
    // Native frontends can focus themselves after async startup. A pointer press
    // or explicit tab selection chooses the pane; a late focus event must not.
    const active = this.injector.get(AppService).activeTab;
    if (active !== (this.topmostParent ?? this)) active?.emitFocused();
    else if (this.parent instanceof SplitTabComponent && this.parent.getFocusedTab() !== this) {
      this.parent.getFocusedTab()?.emitFocused();
    }
  }
  private focusActive() {
    const tab = this.active;
    // SplitTab emits focused$ to every child before focusing its chosen pane.
    // Only that pane may focus a terminal; otherwise DOM focusin would select the last pane.
    if (!tab || !this.visibility.value || this.injector.get(AppService).activeTab !== (this.topmostParent ?? this)
      || (this.parent instanceof SplitTabComponent && this.parent.getFocusedTab() !== this)) return;
    tab.emitFocused();
    requestAnimationFrame(() => {
      if (!this.disposed && this.hasFocus && this.active === tab && this.visibility.value) {
        this.tabStrip?.nativeElement.querySelector('.pane-tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        (tab as BaseTerminalTabComponent<any>).frontend?.focus();
      }
    });
  }
  private updateVisibility() {
    for (const tab of this.tabs) {
      const selected = tab === this.active;
      const visible = selected && this.visibility.value;
      const element = this.elements.get(tab);
      if (element) {
        // Retain geometry so a restored background terminal can initialize its PTY
        // from the first native resize event, without waiting for a tab click.
        element.style.display = !selected && (!(tab instanceof BaseTerminalTabComponent) || tab.frontendIsReady) ? 'none' : '';
        element.style.visibility = visible ? '' : 'hidden';
        element.style.pointerEvents = visible ? '' : 'none';
        element.inert = !visible;
        element.setAttribute('aria-hidden', String(!visible));
      }
      tab.emitVisibility(visible);
    }
  }
  private updateTitle() { this.setTitle(this.active ? this.titleOf(this.active) : '终端'); }
  cycle(delta: number) {
    if (this.tabs.length) this.select(this.tabs[(this.tabs.indexOf(this.active!) + delta + this.tabs.length) % this.tabs.length]);
  }
  navigateTabs(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') this.select(this.tabs[0]);
    else if (event.key === 'End') this.select(this.tabs[this.tabs.length - 1]);
    else this.cycle(event.key === 'ArrowRight' ? 1 : -1);
  }
  async closeTab(tab: BaseTabComponent) {
    if (this.closing.has(tab) || !this.tabs.includes(tab)) return;
    this.closing.add(tab);
    try { if (await tab.canClose() && !this.disposed && this.tabs.includes(tab)) await tab.destroy(); }
    finally { this.closing.delete(tab); }
  }
  runClose(tab: BaseTabComponent) { void this.layout.run(() => this.closeTab(tab)); }
  newShell() { void this.layout.run(() => this.layout.openInPane(this)); }
  menu() { this.focusPane(); this.layout.showMenu(this); }
  rename(tab: BaseTabComponent, event?: MouseEvent) {
    event?.preventDefault(); event?.stopPropagation();
    if (!this.disposed && this.tabs.includes(tab)) this.injector.get(AppService).renameTab(tab);
  }
  tabMenu(event: MouseEvent, tab: BaseTabComponent) {
    event.preventDefault(); event.stopPropagation();
    this.injector.get(PlatformService).popupContextMenu([
      { label: '重命名标签', click: () => this.rename(tab) },
      { label: '关闭此标签', click: () => this.runClose(tab) },
    ]);
  }
  async canClose() {
    for (const tab of this.tabs) if (!await tab.canClose()) return false;
    return true;
  }
  async getCurrentProcess() { return this.active?.getCurrentProcess() ?? null; }
  async getRecoveryToken(options?: GetRecoveryTokenOptions): Promise<RecoveryToken> {
    const recovery = this.injector.get(TabRecoveryService);
    const tabs = [...this.tabs];
    const tokens = await Promise.all(tabs.map(tab => recovery.getFullRecoveryToken(tab, options)));
    const selected = tokens[tabs.indexOf(this.active!)];
    const children = tokens.filter(Boolean);
    return { type: TOKEN_TYPE, version: 1, children, activeIndex: Math.max(0, children.indexOf(selected)) };
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const tab of [...this.tabs, ...this.initialTabs]) tab.destroy();
    this.initialTabs = [];
    for (const subscription of this.subscriptions.values()) subscription.unsubscribe();
    this.subscriptions.clear();
    super.destroy();
  }
}

@Injectable()
export class PaneLayoutService {
  private watched = new WeakSet<SplitTabComponent>();
  constructor(
    @Inject(AppService) private app: AppService,
    @Inject(TabsService) private tabs: TabsService,
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Inject(PlatformService) private platform: PlatformService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(ConfigService) private config: ConfigService,
    @Inject(HotkeysService) private hotkeys: HotkeysService,
  ) {
    // Route the native command before hotkey$ broadcasts it. Merely subscribing to
    // 'new-tab' would also trigger tabby-local and open a second, top-level terminal.
    // Keep native shortcut matching, custom bindings and terminal key suppression.
    this.originalMatchHotkey = hotkeys.matchActiveHotkey;
    this.matchHotkey = partial => {
      const pane = this.currentPane();
      let key = this.originalMatchHotkey.call(hotkeys, partial);
      // Tabby 1.0.238's partial matcher can miss the first single-stroke shortcut
      // after input moves between WebContents. xterm asks again with partial=true
      // to suppress its bytes, so retain exact matches for our pane commands.
      if (!key && partial && (pane || this.hasNativeTerminalSplit())) {
        const exact = this.originalMatchHotkey.call(hotkeys, false);
        if (exact && (exact.startsWith('workbench-pane-') || exact === 'new-tab' || /^tab-[1-9]$/.test(exact))) key = exact;
      }
      if (!key) return null;
      if (key === 'new-tab' && (pane || this.hasNativeTerminalSplit())) return 'workbench-pane-new-tab';
      const numberedTab = key?.match(/^tab-([1-9])$/);
      if (numberedTab && pane) return `workbench-pane-tab-${numberedTab[1]}`;
      // Keep Alt+arrows available to ordinary terminals outside a split workspace.
      if (key?.startsWith('workbench-pane-focus-') && !pane && !this.hasNativeTerminalSplit()) return null;
      return key;
    };
    hotkeys.matchActiveHotkey = this.matchHotkey;
    this.hotkeysSubscription = hotkeys.hotkey$.subscribe(key => {
      if (key === 'workbench-pane-new-tab') {
        const pane = this.currentPane();
        if (pane || this.hasNativeTerminalSplit()) void this.run(() => this.openInPane(pane ?? this.enable()));
        return;
      }
      const direction = FOCUS_DIRECTIONS[key.replace('workbench-pane-focus-', '') as keyof typeof FOCUS_DIRECTIONS];
      if (key.startsWith('workbench-pane-focus-') && direction && this.app.activeTab instanceof SplitTabComponent) {
        this.app.activeTab.navigate(direction);
        return;
      }
      const pane = this.currentPane();
      if (!pane) return;
      const numberedTab = key.match(/^workbench-pane-tab-([1-9])$/);
      if (numberedTab) {
        const tab = pane.tabs[Number(numberedTab[1]) - 1];
        if (tab) pane.select(tab);
        return;
      }
      if (key === 'workbench-pane-next-tab') pane.cycle(1);
      if (key === 'workbench-pane-previous-tab') pane.cycle(-1);
      if (key === 'workbench-pane-close-tab' && pane.active) pane.runClose(pane.active);
    });
  }
  private hotkeysSubscription: Subscription;
  private originalMatchHotkey: HotkeysService['matchActiveHotkey'];
  private matchHotkey: HotkeysService['matchActiveHotkey'];
  ngOnDestroy() {
    this.hotkeysSubscription.unsubscribe();
    if (this.hotkeys.matchActiveHotkey === this.matchHotkey) this.hotkeys.matchActiveHotkey = this.originalMatchHotkey;
  }
  async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    try { return await action(); } catch (error) { this.notifications.error('分屏内标签', String(error)); return undefined; }
  }
  currentPane() {
    const root = this.app.activeTab;
    const focused = root instanceof SplitTabComponent ? root.getFocusedTab() : root;
    return focused instanceof PaneTabsComponent ? focused : null;
  }
  private hasNativeTerminalSplit() {
    const root = this.app.activeTab;
    return root instanceof SplitTabComponent && root.getAllTabs().length > 1
      && root.getFocusedTab() instanceof BaseTerminalTabComponent;
  }
  paneForTab(tab: BaseTabComponent): PaneTabsComponent {
    if (tab instanceof SplitTabComponent) {
      const focused = tab.getFocusedTab();
      if (!focused) throw new Error('分屏已关闭');
      return this.paneForTab(focused);
    }
    if (tab instanceof PaneTabsComponent && !tab.disposed) return tab;
    if (tab.parent instanceof PaneTabsComponent && !tab.parent.disposed && tab.parent.tabs.includes(tab)) return tab.parent;
    if (tab instanceof BaseTerminalTabComponent && tab.parent instanceof SplitTabComponent && tab.parent.getAllTabs().includes(tab)) {
      const root = tab.parent;
      root.focus(tab);
      return this.enable(root);
    }
    throw new Error('请在仍然打开的终端中使用分屏菜单');
  }
  enable(root = this.app.activeTab) {
    if (!(root instanceof SplitTabComponent)) throw new Error('请先打开一个终端标签页');
    const focused = root.getFocusedTab();
    if (!(focused instanceof BaseTerminalTabComponent || focused instanceof PaneTabsComponent)) throw new Error('请先切换到终端');
    this.watch(root);
    let selected: PaneTabsComponent | null = null;
    for (const tab of [...root.getAllTabs()]) {
      const pane = tab instanceof BaseTerminalTabComponent ? this.wrap(root, tab) : tab;
      if (tab === focused && pane instanceof PaneTabsComponent) selected = pane;
    }
    if (selected) { root.focus(selected); setImmediate(() => { if (selected && !selected.disposed) root.focus(selected); }); }
    return selected!;
  }
  watch(root: SplitTabComponent) {
    if (this.watched.has(root)) return;
    this.watched.add(root);
    // Tabby 1.0.238 keeps click/focus listeners on a terminal moved by replaceTab.
    // Resolve their old leaf argument to its new pane; never touch terminal input/output.
    const focus = root.focus;
    root.focus = tab => {
      while (tab.parent && tab.parent !== root) tab = tab.parent;
      if (root.getAllTabs().includes(tab)) focus.call(root, tab);
    };
    const subscription = root.tabAdded$.subscribe(tab => {
      if (tab instanceof BaseTerminalTabComponent && tab.parent === root) this.wrap(root, tab);
    });
    root.destroyed$.subscribe(() => { subscription.unsubscribe(); root.focus = focus; });
  }
  private wrap(root: SplitTabComponent, tab: BaseTabComponent) {
    const pane = this.tabs.create({ type: PaneTabsComponent, inputs: { initialTabs: [tab] } });
    root.replaceTab(tab, pane);
    // Unlike addTab, Tabby's replaceTab does not propagate current visibility.
    root.visibility$.pipe(take(1)).subscribe(visible => pane.emitVisibility(visible));
    // Ownership changes immediately, even before Angular mounts the new component.
    tab.parent = pane;
    root.layout();
    return pane;
  }
  private async shellProfile(source: BaseTabComponent | null): Promise<TerminalProfile> {
    let cwd: string | undefined;
    // A remote shell's path is not a directory on this machine. Only inherit
    // a local session's live cwd, using its launch directory if detection fails.
    if (source instanceof BaseTerminalTabComponent && source.profile?.type === 'local') {
      try { cwd = await source.session?.getWorkingDirectory() || undefined; } catch { /* session may have exited */ }
      cwd ||= source.profile.options?.cwd || undefined;
    }
    cwd ||= this.config.store.codexReferences.workspace || undefined;
    return { type: 'local', name: 'Shell', options: {
      command: process.env.SHELL || '/bin/bash', args: [], cwd,
    } } as TerminalProfile;
  }
  private shellSource(pane: PaneTabsComponent) {
    return pane.active instanceof BaseTerminalTabComponent ? pane.active : pane.lastTerminal ?? pane.initialTabs.at(-1) ?? null;
  }
  bindBrowser(pane: PaneTabsComponent, tab: BrowserTabComponent) {
    tab.openSibling = url => { if (!pane.disposed) void this.run(() => this.openBrowser(pane, url)); };
    tab.paneMenu = () => { pane.focusPane(); this.showMenu(pane); };
    tab.workspaceShortcut = id => {
      if (pane.disposed || pane.active !== tab || this.app.activeTab !== pane.topmostParent) return;
      pane.focusPane();
      if (id === 'new-tab') void this.run(() => this.openInPane(pane));
      const numbered = id.match(/^tab-([1-9])$/);
      if (numbered && pane.tabs[Number(numbered[1]) - 1]) pane.select(pane.tabs[Number(numbered[1]) - 1]);
      const direction = FOCUS_DIRECTIONS[id.replace('workbench-pane-focus-', '') as keyof typeof FOCUS_DIRECTIONS];
      if (id.startsWith('workbench-pane-focus-') && direction && pane.parent instanceof SplitTabComponent) pane.parent.navigate(direction);
      if (id === 'workbench-pane-next-tab') pane.cycle(1);
      if (id === 'workbench-pane-previous-tab') pane.cycle(-1);
      if (id === 'workbench-pane-close-tab') pane.runClose(tab);
    };
  }
  async openBrowser(pane: PaneTabsComponent | null = this.currentPane(), url = '') {
    const normalized = browserURL(url);
    if (pane?.disposed) return null;
    if (!pane && this.app.activeTab instanceof SplitTabComponent
      && this.app.activeTab.getFocusedTab() instanceof BaseTerminalTabComponent) pane = this.enable();
    const tab = this.tabs.create({ type: BrowserTabComponent, inputs: { url: normalized } });
    if (pane) { pane.addTab(tab); pane.select(tab); }
    else await this.app.openNewTab({ type: PaneTabsComponent, inputs: { initialTabs: [tab] } });
    return tab;
  }
  async openInPane(pane: PaneTabsComponent, profile?: TerminalProfile) {
    if (pane.disposed) throw new Error('分屏已关闭');
    // Capture the source before awaiting cwd: changing focus while it resolves
    // must not take the directory from a different terminal or pane.
    profile ??= await this.shellProfile(this.shellSource(pane));
    if (pane.disposed) return null;
    const params = await this.profiles.newTabParametersForProfile(profile);
    if (pane.disposed || !params) return null;
    if (!(params.type.prototype instanceof BaseTerminalTabComponent)) throw new Error('请选择终端连接配置，不能在分屏标签中嵌入整个布局');
    const tab = this.tabs.create(params);
    pane.addTab(tab);
    pane.select(tab);
    return tab;
  }
  async split(pane: PaneTabsComponent, side: 'r' | 'b') {
    if (pane.disposed || !(pane.parent instanceof SplitTabComponent)) return null;
    const root = pane.parent;
    const profile = await this.shellProfile(this.shellSource(pane));
    if (pane.disposed || pane.parent !== root) return null;
    const params = await this.profiles.newTabParametersForProfile(profile);
    if (!params || pane.disposed || pane.parent !== root) return null;
    const child = this.tabs.create(params);
    const next = this.tabs.create({ type: PaneTabsComponent, inputs: { initialTabs: [child] } });
    await root.addTab(next, pane, side);
    root.layout(); root.focus(next);
    return next;
  }
  async chooseProfile(pane: PaneTabsComponent) {
    const profile = await this.profiles.showProfileSelector().catch(() => null);
    if (profile && !pane.disposed) await this.openInPane(pane, profile);
  }
  async openCodex(pane: PaneTabsComponent) {
    const workspace: string = this.config.store.codexReferences.workspace;
    if (!workspace) throw new Error('请先在“Codex 引用”设置中选择项目目录');
    return this.openInPane(pane, { type: 'local', name: 'Codex', options: {
      command: process.env.TABBY_CODEX_LAUNCHER ?? resolve(__dirname, '../../scripts/codex-with-references.py'),
      args: ['--workspace', workspace], cwd: workspace,
    } } as TerminalProfile);
  }
  showMenu(pane = this.currentPane()) {
    if (!pane) {
      void this.run(async () => { this.enable(); });
      return;
    }
    const run = (f: () => Promise<unknown>) => () => { void this.run(f); };
    this.platform.popupContextMenu([
      { label: '在此分屏新建 Shell', click: run(() => this.openInPane(pane)) },
      { label: '在此分屏打开配置…（SSH / 串口等）', click: run(() => this.chooseProfile(pane)) },
      { label: '在此分屏打开 Codex', click: run(() => this.openCodex(pane)) },
      { label: '在此分屏打开网页 / HTML…', click: run(() => this.openBrowser(pane)) },
      { type: 'separator' },
      { label: '向右分屏（新建 Shell）', click: run(() => this.split(pane, 'r')) },
      { label: '向下分屏（新建 Shell）', click: run(() => this.split(pane, 'b')) },
    ]);
  }
}

@Injectable()
export class PaneRecovery extends TabRecoveryProvider<PaneTabsComponent> {
  async applicableTo(token: RecoveryToken) { return token.type === TOKEN_TYPE && token.version === 1; }
  async recover(token: RecoveryToken) { return { type: PaneTabsComponent, inputs: { recoveredState: token } }; }
}

@Injectable()
export class PaneToolbar extends ToolbarButtonProvider {
  constructor(@Inject(PaneLayoutService) private layout: PaneLayoutService) { super(); }
  provide() { return [{ title: '打开网页 / HTML', weight: 12,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>',
    click: () => { void this.layout.run(() => this.layout.openBrowser()); },
  }, { title: '分屏内标签', weight: 11,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M3 8h18M7 4v4M16 4v4"/></svg>',
    click: () => this.layout.showMenu(),
  }]; }
}

@Injectable()
export class PaneMenu extends TabContextMenuItemProvider {
  weight = 61;
  constructor(@Inject(PaneLayoutService) private layout: PaneLayoutService) { super(); }
  async getItems(tab: BaseTabComponent, tabHeader = false): Promise<MenuItemOptions[]> {
    if (!(tab instanceof BaseTerminalTabComponent || tab instanceof PaneTabsComponent || tab instanceof SplitTabComponent)) return [];
    if (!tabHeader && tab instanceof BaseTerminalTabComponent) {
      return (['r', 'b'] as const).map(side => ({
        label: side === 'r' ? '向右分屏' : '向下分屏',
        click: () => { void this.layout.run(async () => {
          const pane = this.layout.paneForTab(tab);
          pane.focusPane();
          await this.layout.split(pane, side);
        }); },
      }));
    }
    return [{ label: '分屏内标签', click: () => { void this.layout.run(async () => {
      const pane = this.layout.paneForTab(tab);
      pane.focusPane(); this.layout.showMenu(pane);
    }); } }];
  }
}

@Injectable()
export class PaneHotkeys extends HotkeyProvider {
  async provide() { return [
    { id: 'workbench-pane-new-tab', name: '分屏内标签：新建 Shell' },
    { id: 'workbench-pane-next-tab', name: '分屏内标签：下一个终端' },
    { id: 'workbench-pane-previous-tab', name: '分屏内标签：上一个终端' },
    { id: 'workbench-pane-close-tab', name: '分屏内标签：关闭当前终端' },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `workbench-pane-tab-${i + 1}`, name: `分屏内标签：切换到第 ${i + 1} 个终端` })),
    { id: 'workbench-pane-focus-left', name: '分屏：焦点向左' },
    { id: 'workbench-pane-focus-right', name: '分屏：焦点向右' },
    { id: 'workbench-pane-focus-up', name: '分屏：焦点向上' },
    { id: 'workbench-pane-focus-down', name: '分屏：焦点向下' },
  ]; }
}

@Injectable()
export class PaneConfig extends ConfigProvider {
  defaults = { hotkeys: {
    'workbench-pane-new-tab': [], 'workbench-pane-next-tab': [],
    'workbench-pane-previous-tab': [], 'workbench-pane-close-tab': [],
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`workbench-pane-tab-${i + 1}`, []])),
    'workbench-pane-focus-left': ['Alt-Left'], 'workbench-pane-focus-right': ['Alt-Right'],
    'workbench-pane-focus-up': ['Alt-Up'], 'workbench-pane-focus-down': ['Alt-Down'],
  } };
}
