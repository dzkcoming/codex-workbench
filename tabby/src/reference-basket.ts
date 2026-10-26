import { ChangeDetectorRef, Component, Inject, Injectable, Injector, NgZone } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { AppService, BaseTabComponent, HotkeysService, NotificationsService, PlatformService, ToolbarButtonProvider } from 'tabby-core';
import { ReferenceBridge } from './bridge';
import { MAX_NOTE, type BasketItem, type BasketView } from './basket';
import type { ReferencePage, ReferenceSource } from './references';

export interface CapturedSelection { text: string; source: ReferenceSource; }
/** Implemented by the existing reference service, keeping this UI independent of the module. */
export abstract class BasketSource {
  abstract readonly workspace: string;
  abstract readonly enabled: boolean;
  abstract captureActive(): CapturedSelection;
  abstract requireWorkspace(): Promise<string>;
}

@Injectable()
export class ReferenceBasketService {
  readonly changed = new Subject<string>();
  private bridge = new ReferenceBridge();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private counts = new Map<string, number>();
  private subscription: Subscription;
  private originalMatch: HotkeysService['matchActiveHotkey'];
  private match: HotkeysService['matchActiveHotkey'];
  constructor(
    @Inject(BasketSource) public source: BasketSource,
    @Inject(AppService) private app: AppService,
    @Inject(PlatformService) public platform: PlatformService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(HotkeysService) private hotkeys: HotkeysService,
    @Inject(NgZone) private zone: NgZone,
  ) {
    this.originalMatch = hotkeys.matchActiveHotkey;
    this.match = partial => {
      const matched = this.originalMatch.call(hotkeys, partial);
      if (matched || !partial) return matched;
      // Also suppress the first recognized key after crossing native webpage focus.
      const exact = this.originalMatch.call(hotkeys, false);
      return exact?.startsWith('reference-basket-') ? exact : null;
    };
    hotkeys.matchActiveHotkey = this.match;
    this.subscription = hotkeys.hotkey$.subscribe(key => {
      const editing = document.activeElement;
      if (editing?.matches('input,textarea,[contenteditable="true"]') && !editing.closest('.xterm')) return;
      if (key === 'reference-basket-collect') void this.run(async () => this.addCaptured(this.source.captureActive()));
      if (key === 'reference-basket-open') void this.run(() => this.open());
    });
  }
  count(workspace: string) { return this.counts.get(workspace); }
  async run(action: () => Promise<unknown>) {
    try { return await action(); } catch (e) { this.notifications.error('引用篮', String(e)); }
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.pending >= 16) return Promise.reject(new Error('引用正在保存，请稍后再添加'));
    this.pending++;
    const result = this.queue.then(action);
    this.queue = result.catch(() => {}).finally(() => this.zone.run(() => { this.pending--; }));
    return result;
  }
  addCaptured(captured: CapturedSelection, workspace = this.source.workspace) {
    if (!this.source.enabled) return Promise.reject(new Error('终端引用功能已停用'));
    // Capture text, origin and project now, before waiting for preceding disk work.
    const selection = { text: captured.text, source: { ...captured.source } };
    return this.enqueue(async () => {
      const project = workspace || await this.source.requireWorkspace();
      const result = await this.bridge.request<{ count: number }>(project, 'basket-add', selection);
      this.counts.set(project, result.count); this.changed.next(project);
      this.notifications.notice(`已加入引用篮 · ${result.count} 条`);
      return result;
    });
  }
  load(workspace: string) {
    return this.enqueue(async () => {
      const view = await this.bridge.request<BasketView>(workspace, 'basket-view');
      this.counts.set(workspace, view.items.length);
      return view;
    });
  }
  update(workspace: string, action: string, revision: number, id = '', note = '') {
    return this.enqueue(async () => {
      const view = await this.bridge.request<BasketView>(workspace, 'basket-update', { action, revision, reference_id: id, note });
      this.counts.set(workspace, view.items.length); this.changed.next(workspace);
      return view;
    });
  }
  read(workspace: string, id: string) {
    return this.enqueue(() => this.bridge.request<ReferencePage>(workspace, 'read', { reference_id: id, max_characters: 16000 }));
  }
  copy(workspace: string, revision: number) {
    return this.enqueue(async () => {
      const result = await this.bridge.request<{ prompt: string; count: number }>(workspace, 'basket-copy', { revision });
      this.platform.setClipboard({ text: result.prompt });
      this.notifications.info(`已复制 ${result.count} 条引用`, '回到当前 Codex 会话粘贴，再补充问题。');
    });
  }
  async open() {
    const workspace = await this.source.requireWorkspace();
    const returnTab = this.app.activeTab instanceof ReferenceBasketTab ? this.app.activeTab.returnTab : this.app.activeTab;
    const existing = this.app.tabs.find(t => t instanceof ReferenceBasketTab && t.workspace === workspace);
    if (existing instanceof ReferenceBasketTab) { existing.returnTab = returnTab; this.app.selectTab(existing); return; }
    await this.app.openNewTabRaw({ type: ReferenceBasketTab, inputs: { workspace, returnTab } });
  }
  ngOnDestroy() {
    this.subscription.unsubscribe(); this.changed.complete(); this.bridge.close();
    if (this.hotkeys.matchActiveHotkey === this.match) this.hotkeys.matchActiveHotkey = this.originalMatch;
  }
}

@Component({
  selector: 'reference-basket',
  template: `
    <div class="basket-shell">
      <header><div><h2>引用篮 <span>{{items.length}}</span></h2><p>收集多个终端的资料，一次交给当前 Codex 会话。</p></div>
        <button class="btn btn-primary" (click)="copyAll()" [disabled]="busy || !items.length || broken">复制全部引用</button>
      </header>
      <div class="project" [title]="workspace">{{workspace}}</div>
      <div class="basket-actions">
        <button class="btn btn-sm btn-secondary" (click)="refresh()" [disabled]="busy">刷新</button>
        <button class="btn btn-sm btn-secondary" (click)="back()" [disabled]="!returnTab">返回终端</button>
        <button class="btn btn-sm btn-secondary" (click)="clear()" [disabled]="busy || !items.length">清空引用篮</button>
        <span>移除或清空只整理篮子，已保存的快照仍保留。</span>
      </div>
      <p *ngIf="error" class="alert alert-danger" role="alert">{{error}}</p>
      <p *ngIf="message" class="basket-status" role="status">{{message}}</p>
      <p *ngIf="busy && !items.length" class="basket-status" role="status">正在读取引用篮…</p>
      <div *ngIf="!items.length && !busy" class="basket-empty">
        <h3>从一段终端输出开始</h3>
        <p>选中内容，从顶部标签栏右键“Codex 引用 → 加入引用篮（备用）”收集。</p>
        <p>日常可在终端正文右键“引用到 Codex”或按 Ctrl+Shift+Y，直接放入接收分屏的 Codex 草稿。</p>
        <p>继续到其他终端添加，再用工具栏“引用篮”或默认快捷键 Ctrl+Shift+B 回来整理。</p>
      </div>
      <article *ngFor="let item of items; let i = index; trackBy: track" class="basket-item">
        <div class="item-heading"><strong>{{i + 1}} · {{item.reference?.source?.name || item.id}}</strong>
          <div class="item-actions">
            <button class="btn btn-sm btn-secondary" [attr.aria-label]="'上移引用 ' + (i+1)" (click)="update('up', item)" [disabled]="busy || !i">↑</button>
            <button class="btn btn-sm btn-secondary" [attr.aria-label]="'下移引用 ' + (i+1)" (click)="update('down', item)" [disabled]="busy || i === items.length-1">↓</button>
            <button class="btn btn-sm btn-secondary" [attr.aria-label]="'移除引用 ' + (i+1)" (click)="update('remove', item)" [disabled]="busy">移除</button>
          </div>
        </div>
        <small *ngIf="item.reference">{{item.reference.source.kind}} · {{item.reference.source.captured_at | date:'yyyy-MM-dd HH:mm:ss'}} · {{item.reference.bytes}} 字节</small>
        <p *ngIf="item.error" class="text-danger">{{item.error}}</p>
        <details *ngIf="item.reference" (toggle)="preview(item, $event)">
          <summary>预览选区</summary>
          <p *ngIf="previewErrors[item.id]" class="text-danger">{{previewErrors[item.id]}}</p>
          <pre>{{previews[item.id]?.text || '正在读取…'}}</pre>
          <p *ngIf="previews[item.id]?.has_more">预览前 16000 个字符；复制时会附上完整快照路径。</p>
          <button class="btn btn-sm btn-secondary" (click)="reveal(item)">打开快照位置</button>
        </details>
        <label [attr.for]="'note-' + item.id">备注</label>
        <textarea class="form-control" [id]="'note-' + item.id" [attr.aria-label]="'引用 ' + (i+1) + ' 的备注'" rows="2"
          [(ngModel)]="drafts[item.id]" [maxLength]="noteLimit" [disabled]="busy" placeholder="例如：这段日志来自复位后的第一次启动"></textarea>
        <button class="btn btn-sm btn-secondary note-save" (click)="saveNotes()" [disabled]="busy || drafts[item.id] === item.note">保存备注</button>
      </article>
    </div>`,
  styles: [`
    :host{display:block;width:100%;min-width:0;flex:1;height:100%;overflow:auto;color:var(--theme-fg,inherit);background:var(--theme-bg,#171717)}
    .basket-shell{max-width:960px;margin:auto;padding:28px 32px 60px}header{display:flex;gap:24px;justify-content:space-between;align-items:center}
    h2{font-size:26px;margin:0 0 8px}h2 span{font-size:16px;opacity:.6;margin-left:8px}header p{margin:0;opacity:.7}
    .project{margin:20px 0 14px;font-size:12px;opacity:.65;overflow-wrap:anywhere}.basket-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .basket-actions span{font-size:12px;opacity:.65}.basket-item{padding:20px 0;border-bottom:1px solid #8884}
    .item-heading{display:flex;align-items:center;gap:16px;justify-content:space-between}.item-heading strong{overflow-wrap:anywhere}.item-actions{display:flex;gap:6px;flex-shrink:0}
    small{display:block;opacity:.65;margin:6px 0 12px}details{margin:12px 0}summary{cursor:pointer;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;margin-top:10px;padding:12px;background:#8881;color:inherit}
    label{display:block;margin:12px 0 6px;font-size:12px}textarea{resize:vertical}.note-save{margin-top:8px}.basket-status{margin-top:14px}.basket-empty{padding:60px 0;opacity:.75}.basket-empty h3{font-size:20px}
    @media(max-width:600px){.basket-shell{padding:20px 16px}header{align-items:flex-start;flex-direction:column}}
  `],
})
export class ReferenceBasketTab extends BaseTabComponent {
  workspace = '';
  items: BasketItem[] = [];
  revision = 0;
  drafts: Record<string, string> = {};
  previews: Record<string, ReferencePage> = {};
  previewErrors: Record<string, string> = {};
  busy = false; error = ''; message = '';
  noteLimit = MAX_NOTE;
  returnTab: BaseTabComponent | null;
  private subscription = new Subscription();
  private refreshPending = false;
  private basketDestroyed = false;
  constructor(@Inject(Injector) injector: Injector, @Inject(ReferenceBasketService) public basket: ReferenceBasketService,
    @Inject(AppService) private app: AppService, @Inject(ChangeDetectorRef) private changes: ChangeDetectorRef) {
    super(injector); this.setTitle('引用篮'); this.returnTab = app.activeTab;
  }
  ngOnInit() {
    void this.refresh();
    this.subscription.add(this.basket.changed.subscribe(workspace => { if (workspace === this.workspace) void this.refresh(); }));
    this.subscription.add(this.focused$.subscribe(() => { if (this.workspace) void this.refresh(); }));
  }
  get broken() { return this.items.some(i => i.error); }
  track(_index: number, item: BasketItem) { return item.id; }
  private apply(view: BasketView) {
    const next: Record<string, string> = {};
    for (const item of view.items) {
      const previous = this.items.find(i => i.id === item.id);
      next[item.id] = previous && this.drafts[item.id] !== previous.note ? this.drafts[item.id] : item.note;
    }
    this.items = view.items; this.revision = view.revision; this.drafts = next;
    this.setTitle(`引用篮 · ${this.items.length}`);
  }
  private async operation(action: () => Promise<void>, resetMessage = true) {
    if (this.busy) return;
    this.busy = true; this.error = ''; if (resetMessage) this.message = '';
    try { await action(); } catch (e) { this.error = String(e); }
    finally {
      this.busy = false;
      const refresh = this.refreshPending && !this.error && !this.basketDestroyed;
      this.refreshPending = false;
      // Node worker replies/native async continuations can run outside Angular's zone.
      if (!this.basketDestroyed) this.changes.detectChanges();
      if (refresh) void this.refresh();
    }
  }
  async refresh() {
    if (this.busy) { this.refreshPending = true; return; }
    await this.operation(async () => this.apply(await this.basket.load(this.workspace)), false);
  }
  private async persistNotes() {
    for (const item of [...this.items]) {
      const note = this.drafts[item.id];
      if (note !== item.note) this.apply(await this.basket.update(this.workspace, 'note', this.revision, item.id, note));
    }
  }
  async saveNotes() { await this.operation(async () => { await this.persistNotes(); this.message = '备注已保存'; }); }
  async copyAll() { await this.operation(async () => { await this.persistNotes(); await this.basket.copy(this.workspace, this.revision); this.message = '已复制全部引用。回到 Codex 粘贴，再补充问题。'; }); }
  async update(action: string, item: BasketItem) {
    await this.operation(async () => { await this.persistNotes(); this.apply(await this.basket.update(this.workspace, action, this.revision, item.id)); });
  }
  async clear() {
    await this.operation(async () => {
      const choice = await this.basket.platform.showMessageBox({ type: 'warning', message: '清空这次收集的引用？', detail: '篮内的备注和顺序会清除，已保存的终端快照仍保留。', buttons: ['取消', '清空引用篮'], defaultId: 0, cancelId: 0 });
      if (choice.response === 1) this.apply(await this.basket.update(this.workspace, 'clear', this.revision));
    });
  }
  async preview(item: BasketItem, event: Event) {
    if (!(event.target as HTMLDetailsElement).open || this.previews[item.id]) return;
    try { this.previews[item.id] = await this.basket.read(this.workspace, item.id); delete this.previewErrors[item.id]; }
    catch (e) { this.previewErrors[item.id] = String(e); }
    finally { if (!this.basketDestroyed) this.changes.detectChanges(); }
  }
  reveal(item: BasketItem) { if (item.reference) this.basket.platform.showItemInFolder(item.reference.path); }
  back() { if (this.returnTab && this.app.tabs.includes(this.returnTab)) this.app.selectTab(this.returnTab); }
  async canClose() { if (this.busy) return false; await this.saveNotes(); return !this.error; }
  ngOnDestroy() { this.basketDestroyed = true; this.subscription.unsubscribe(); super.ngOnDestroy(); }
}

@Injectable()
export class BasketToolbar extends ToolbarButtonProvider {
  constructor(@Inject(ReferenceBasketService) private basket: ReferenceBasketService) { super(); }
  provide() {
    const basket = this.basket;
    return [{ weight: 10, get title() { const n = basket.count(basket.source.workspace); return n === undefined ? '引用篮' : `引用篮（${n}）`; },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 8h18l-2 12H5L3 8zm4 0 3-5m7 5-3-5M9 12v4m6-4v4"/></svg>',
      click: () => { void basket.run(() => basket.open()); },
    }];
  }
}
