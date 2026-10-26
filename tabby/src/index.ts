import { Component, Inject, Injectable, NgModule, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  AppService, BaseTabComponent, ConfigProvider, ConfigService, HotkeyProvider, HotkeysService,
  NotificationsService, PlatformService, ProfilesService, SplitTabComponent, TabContextMenuItemProvider,
  TabRecoveryProvider, ToolbarButtonProvider, TranslateService, type MenuItemOptions,
} from 'tabby-core';
import { BaseTerminalTabComponent } from 'tabby-terminal';
import { SettingsTabProvider } from 'tabby-settings';
import { ReferenceBridge } from './bridge';
import { MAX_BYTES, STORE_DIRECTORY, type ReferenceSource, type ReferenceSummary } from './references';
import { PaneTabsComponent, PaneLayoutService, PaneRecovery, PaneToolbar, PaneMenu, PaneHotkeys, PaneConfig } from './pane-tabs';
import { BrowserTabComponent, BrowserRecovery } from './browser-tab';
import { BasketSource, BasketToolbar, ReferenceBasketService, ReferenceBasketTab } from './reference-basket';
import { CodexReferenceService } from './codex-reference';
export { CodexReferenceService } from './codex-reference';

export { PaneTabsComponent, PaneLayoutService } from './pane-tabs';
export { BrowserTabComponent } from './browser-tab';
export { ReferenceBasketService, ReferenceBasketTab } from './reference-basket';

export type { ReferenceSummary, ReferenceSource } from './references';

/** Extension point for future plugins; receives a fixed reference, never a live PTY. */
export abstract class ReferenceActionProvider {
  abstract getActions(reference: ReferenceSummary): Promise<MenuItemOptions[]>;
}

@Injectable()
export class ReferenceConfig extends ConfigProvider {
  defaults = {
    codexReferences: { enabled: true, workspace: process.env.TABBY_REFERENCE_WORKSPACE ?? '' },
    hotkeys: { 'codex-reference-create': [], 'reference-basket-add': ['Ctrl-Shift-Y'], 'reference-basket-collect': [], 'reference-basket-open': ['Ctrl-Shift-B'] },
  };
}

@Injectable()
export class ReferencesService {
  private bridge = new ReferenceBridge();
  private terminals = new WeakMap<object, string>();
  private sessions = new WeakMap<object, string>();
  private creating = false;
  private hotkeysSubscription;
  public readonly extensions: ReferenceActionProvider[];

  constructor(
    @Inject(ConfigService) public config: ConfigService,
    @Inject(PlatformService) public platform: PlatformService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(AppService) private app: AppService,
    @Inject(HotkeysService) hotkeys: HotkeysService,
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Optional() @Inject(ReferenceActionProvider) extensions: ReferenceActionProvider[] | null,
  ) {
    this.extensions = extensions ?? [];
    this.hotkeysSubscription = hotkeys.hotkey$.subscribe(key => {
      if (key === 'codex-reference-create' && this.enabled) void this.run(() => this.createFromSelection(this.activeTerminal()));
    });
  }
  get enabled() { return !!this.config.store.codexReferences.enabled; }
  get workspace(): string { return this.config.store.codexReferences.workspace; }
  ngOnDestroy() { this.hotkeysSubscription.unsubscribe(); this.bridge.close(); }

  terminal(tab: BaseTabComponent | null): BaseTerminalTabComponent<any> | null {
    while (tab instanceof SplitTabComponent || tab instanceof PaneTabsComponent) {
      tab = tab instanceof PaneTabsComponent ? tab.active : tab.getFocusedTab();
    }
    return tab instanceof BaseTerminalTabComponent ? tab : null;
  }
  activeTerminal() { return this.terminal(this.app.activeTab); }
  captureActive() { return this.capture(this.activeTerminal()); }
  async run(action: () => Promise<unknown>) {
    try { return await action(); } catch (error) { this.notifications.error('Codex 引用', String(error)); return undefined; }
  }
  async setWorkspace(workspace: string) {
    await this.bridge.request(workspace, 'list', { limit: 1 });
    this.config.store.codexReferences.workspace = workspace;
    await this.config.save();
  }
  async chooseWorkspace() {
    const folder = await this.platform.pickDirectory();
    if (folder) await this.setWorkspace(folder);
    return folder;
  }
  async requireWorkspace() {
    if (!this.workspace) await this.chooseWorkspace();
    if (!this.workspace) throw new Error('请先选择与 Codex 一致的本机项目目录');
    return this.workspace;
  }
  private identity(map: WeakMap<object, string>, object: object) {
    let id = map.get(object); if (!id) { id = randomUUID(); map.set(object, id); } return id;
  }
  capture(tab: BaseTerminalTabComponent<any> | null) {
    if (!tab?.frontend) throw new Error('请先切换到需要引用的终端');
    const text = tab.frontend.getSelection();
    if (!text) throw new Error('请先在终端中选中需要引用的内容');
    if (text.length > MAX_BYTES || Buffer.byteLength(text) > MAX_BYTES) throw new Error('选区超过 2 MiB，请缩小选区');
    const source: ReferenceSource = {
      terminal_id: this.identity(this.terminals, tab), session_id: this.identity(this.sessions, tab.session ?? tab),
      // displayTitle exists in the tested 1.0.238 host; published typings lag behind it.
      name: ((tab as BaseTerminalTabComponent<any> & { displayTitle?: string }).displayTitle || tab.title || tab.profile?.name || '终端').slice(0, 256), kind: (tab.profile?.type || 'terminal').slice(0, 64),
      captured_at: new Date().toISOString(),
    };
    return { text, source };
  }
  async createFromSelection(tab: BaseTerminalTabComponent<any> | null) {
    return this.createCaptured(this.capture(tab));
  }
  async createCaptured(captured: { text: string; source: ReferenceSource }) {
    if (!this.enabled) throw new Error('终端引用功能已停用');
    if (this.creating) throw new Error('正在保存引用，请稍后');
    this.creating = true;
    try {
      const workspace = await this.requireWorkspace();
      const result = await this.bridge.request<{ reference: ReferenceSummary; prompt: string }>(workspace, 'create', captured);
      this.platform.setClipboard({ text: result.prompt });
      this.notifications.info('引用已保存并复制', '切换到 Codex，粘贴引用并补充问题后发送。');
      return result.reference;
    } finally { this.creating = false; }
  }
  async recent(workspace = this.workspace) {
    return (await this.bridge.request<{ references: ReferenceSummary[] }>(workspace, 'list', { limit: 30 })).references;
  }
  async copy(reference: ReferenceSummary, workspace = this.workspace) {
    const result = await this.bridge.request(workspace, 'copy', { reference_id: reference.id });
    this.platform.setClipboard({ text: result.prompt });
    this.notifications.notice('引用已复制');
  }
  async copyLatest() {
    const workspace = await this.requireWorkspace();
    const references = await this.recent(workspace);
    if (!references.length) throw new Error('当前项目还没有引用');
    await this.copy(references[0], workspace);
  }
  async openFolder() { const workspace = await this.requireWorkspace(); this.platform.openPath(join(workspace, STORE_DIRECTORY)); }
  async openCodex() {
    const workspace = await this.requireWorkspace();
    const launcher = process.env.TABBY_CODEX_LAUNCHER ?? resolve(__dirname, '../../scripts/codex-with-references.py');
    return this.profiles.openNewTabForProfile({
      type: 'local', name: 'Codex', options: { command: launcher, args: ['--workspace', workspace], cwd: workspace },
    } as any);
  }
  async showExtensions(reference: ReferenceSummary) {
    const menus = (await Promise.all(this.extensions.map(extension => extension.getActions(reference)))).flat();
    if (menus.length) this.platform.popupContextMenu(menus);
  }
}

@Injectable()
export class ReferenceMenu extends TabContextMenuItemProvider {
  weight = 60;
  constructor(@Inject(ReferencesService) private references: ReferencesService,
    @Inject(ReferenceBasketService) private basket: ReferenceBasketService,
    @Inject(CodexReferenceService) private direct: CodexReferenceService) { super(); }
  async getItems(base: BaseTabComponent): Promise<MenuItemOptions[]> {
    if (!this.references.enabled) return [];
    const tab = this.references.terminal(base); if (!tab) return [];
    // Snapshot the selection at menu-open time: terminal output may keep scrolling while the menu is open.
    let captured: ReturnType<ReferencesService['capture']> | null = null;
    try { captured = this.references.capture(tab); } catch { /* empty or oversized selection handled on click */ }
    const run = (f: () => Promise<unknown>) => () => { void this.references.run(f); };
    const workspace = this.references.workspace;
    return [{ label: '引用到 Codex', enabled: !!captured,
      click: () => { if (captured) void this.direct.run(() => this.direct.send(this.direct.capture(tab, captured!, workspace))); } },
    { label: 'Codex 引用', submenu: [
      { label: '选择接收引用的分屏…', click: () => { void this.direct.run(() => this.direct.chooseReceiver(tab)); } },
      { label: '加入引用篮（备用）', enabled: !!captured, click: () => { if (captured) void this.basket.run(() => this.basket.addCaptured(captured!, workspace)); } },
      { label: '打开引用篮…', click: () => { void this.basket.run(() => this.basket.open()); } },
      { label: '创建选区引用并复制', enabled: !!tab.frontend?.getSelection(), click: run(() => captured
        ? this.references.createCaptured(captured) : this.references.createFromSelection(tab)) },
      { label: '复制最近一条引用', click: run(() => this.references.copyLatest()) },
      { type: 'separator' },
      { label: '在当前引用项目打开 Codex', click: run(() => this.references.openCodex()) },
      { label: '选择引用项目…', click: run(() => this.references.chooseWorkspace()) },
      { label: '打开引用目录', click: run(() => this.references.openFolder()) },
    ] }];
  }
}

@Injectable()
export class ReferenceHotkeys extends HotkeyProvider {
  async provide() { return [
    { id: 'codex-reference-create', name: 'Codex：创建终端选区引用并复制' },
    { id: 'reference-basket-add', name: 'Codex：引用选区到当前接收分屏' },
    { id: 'reference-basket-collect', name: '引用篮：收集选区（备用）' },
    { id: 'reference-basket-open', name: '引用篮：打开整理页面' },
  ]; }
}

/** Keep terminal-body menus small; header menus and command providers stay available. */
@Injectable()
export class CompactTerminalMenu {
  private original = BaseTerminalTabComponent.prototype.buildContextMenu;
  private build: BaseTerminalTabComponent<any>['buildContextMenu'];
  constructor(@Inject(TabContextMenuItemProvider) providers: TabContextMenuItemProvider[],
    @Inject(TranslateService) translate: TranslateService, @Inject(NotificationsService) notifications: NotificationsService) {
    const panes = providers.find(p => p instanceof PaneMenu);
    const references = providers.find(p => p instanceof ReferenceMenu);
    this.build = async function (this: BaseTerminalTabComponent<any>) {
      const tab = this;
      const sections: MenuItemOptions[][] = [[
        { label: translate.instant('Copy'), enabled: !!tab.frontend?.getSelection(), click: () => {
          setTimeout(() => { tab.frontend?.copySelection(); notifications.notice(translate.instant('Copied')); });
        } },
        // Use native paste: bracketed paste and multiline confirmation still apply.
        { label: translate.instant('Paste'), click: () => tab.paste() },
      ]];
      const [split, reference] = await Promise.all([panes?.getItems(tab) ?? [], references?.getItems(tab) ?? []]);
      sections.push(split, reference.filter(item => item.label === '引用到 Codex'));
      return sections.filter(section => section.length).flatMap((section, index) => index ? [{ type: 'separator' as const }, ...section] : section);
    };
    BaseTerminalTabComponent.prototype.buildContextMenu = this.build;
  }
  ngOnDestroy() {
    if (BaseTerminalTabComponent.prototype.buildContextMenu === this.build) BaseTerminalTabComponent.prototype.buildContextMenu = this.original;
  }
}

@Component({
  selector: 'codex-reference-settings',
  template: `
    <h3>Codex 引用</h3>
    <p>选中终端内容，右键“引用到 Codex”或按 Ctrl+Shift+Y，放入同一调试页接收分屏当前显示的 Codex 草稿。</p>
    <label class="form-check mb-3"><input class="form-check-input" type="checkbox" [(ngModel)]="service.config.store.codexReferences.enabled" (change)="saveEnabled()"> 启用终端引用</label>
    <div class="form-group"><label for="reference-workspace">引用项目目录</label>
      <input id="reference-workspace" class="form-control" [(ngModel)]="workspace" placeholder="选择与 Codex 一致的本机项目目录">
      <small class="form-text text-muted">快照保存在项目的 .terminal-references 目录。切换项目后，历史引用仍留在原项目。</small>
    </div>
    <div class="reference-buttons">
      <button class="btn btn-secondary" (click)="choose()">选择目录</button>
      <button class="btn btn-primary" (click)="save()" [disabled]="busy">保存项目</button>
      <button class="btn btn-secondary" (click)="openCodex()">打开 Codex</button>
    </div>
    <p class="text-muted">自动跟随接收分屏当前显示的 Codex 标签，不自动发送。无法确认目标时只复制引用，供你手动粘贴。标签栏右键的“Codex 引用”中可更换接收分屏或使用备用引用篮。</p>
    <h4>最近引用 <button class="btn btn-sm btn-secondary" (click)="refresh()" [disabled]="busy">刷新</button></h4>
    <p *ngIf="error" role="alert" class="text-danger">{{error}}</p>
    <p *ngIf="!items.length && !busy" class="text-muted">当前项目还没有引用。先在任意终端选中内容并创建引用。</p>
    <div *ngFor="let ref of items" class="reference-item">
      <strong>{{ref.source.name}}</strong> <small>{{ref.source.captured_at}} · {{ref.bytes}} 字节</small>
      <div class="reference-id">{{ref.id}}</div>
      <button class="btn btn-sm btn-secondary" (click)="copy(ref)">复制引用</button>
      <button class="btn btn-sm btn-secondary" (click)="reveal(ref)">打开位置</button>
      <button *ngIf="service.extensions.length" class="btn btn-sm btn-secondary" (click)="extensions(ref)">扩展操作</button>
    </div>`,
  styles: [':host{display:block}.reference-buttons{display:flex;gap:8px;margin:14px 0}.reference-item{padding:12px 0;border-bottom:1px solid #8884}.reference-item small{opacity:.7}.reference-item button{margin-right:8px}.reference-id{font-family:monospace;opacity:.6;font-size:11px;margin:4px 0 8px;overflow-wrap:anywhere}'],
})
export class ReferenceSettingsComponent {
  workspace: string; items: ReferenceSummary[] = []; error = ''; busy = false; private loadedWorkspace = '';
  constructor(@Inject(ReferencesService) public service: ReferencesService) { this.workspace = service.workspace; }
  ngOnInit() { if (this.workspace) void this.refresh(); }
  async operation(f: () => Promise<void>) {
    if (this.busy) return; this.busy = true; this.error = '';
    try { await f(); } catch (error) { this.error = String(error); } finally { this.busy = false; }
  }
  async saveEnabled() { await this.service.config.save(); }
  async load() { const workspace = this.service.workspace; this.items = await this.service.recent(workspace); this.loadedWorkspace = workspace; }
  async refresh() { await this.operation(() => this.load()); }
  async save() { await this.operation(async () => { await this.service.setWorkspace(this.workspace); await this.load(); }); }
  async choose() { await this.operation(async () => { if (await this.service.chooseWorkspace()) { this.workspace = this.service.workspace; await this.load(); } }); }
  async copy(ref: ReferenceSummary) { await this.operation(async () => { await this.service.copy(ref, this.loadedWorkspace); }); }
  reveal(ref: ReferenceSummary) { this.service.platform.showItemInFolder(ref.path); }
  async openCodex() { await this.operation(async () => { await this.service.openCodex(); }); }
  async extensions(ref: ReferenceSummary) { await this.operation(() => this.service.showExtensions(ref)); }
}

@Injectable()
export class ReferenceSettings extends SettingsTabProvider {
  id = 'codex-references'; icon = 'fas fa-quote-right'; title = 'Codex 引用';
  getComponentType() { return ReferenceSettingsComponent; }
}

@NgModule({
  imports: [CommonModule, FormsModule], declarations: [ReferenceSettingsComponent, PaneTabsComponent, BrowserTabComponent, ReferenceBasketTab],
  providers: [ReferencesService, PaneLayoutService, ReferenceBasketService, CodexReferenceService, CompactTerminalMenu,
    { provide: BasketSource, useExisting: ReferencesService },
    { provide: ToolbarButtonProvider, useClass: BasketToolbar, multi: true },
    { provide: ConfigProvider, useClass: PaneConfig, multi: true },
    { provide: TabRecoveryProvider, useClass: PaneRecovery, multi: true },
    { provide: TabRecoveryProvider, useClass: BrowserRecovery, multi: true },
    { provide: ToolbarButtonProvider, useClass: PaneToolbar, multi: true },
    { provide: TabContextMenuItemProvider, useClass: PaneMenu, multi: true },
    { provide: HotkeyProvider, useClass: PaneHotkeys, multi: true },
    { provide: ConfigProvider, useClass: ReferenceConfig, multi: true },
    { provide: TabContextMenuItemProvider, useClass: ReferenceMenu, multi: true },
    { provide: HotkeyProvider, useClass: ReferenceHotkeys, multi: true },
    { provide: SettingsTabProvider, useClass: ReferenceSettings, multi: true },
  ],
})
export default class CodexReferencesModule {
  constructor(@Inject(ReferencesService) _references: ReferencesService, @Inject(ReferenceBasketService) _basket: ReferenceBasketService,
    @Inject(CompactTerminalMenu) _menu: CompactTerminalMenu) {}
}
