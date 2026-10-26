/** Adapted from tabby-browser, MIT © 2026 Karol Nowacki.
 * Upstream fd1de8632f15b793522623a29ebf968d0b8a5e3a; see ../licenses/tabby-browser-MIT.txt.
 * Workbench changes: pane ownership, synchronous main-process shortcuts, local files,
 * isolated session, modal visibility, disposal, and Chinese controls.
 */
import { Component, Inject, Injectable, Injector, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone } from '@angular/core'
import { BaseTabComponent, RecoveryToken, AppService, HotkeysService, SplitTabComponent, PlatformService, TabRecoveryProvider } from 'tabby-core'
import { Subscription } from 'rxjs'
import type { BrowserWindow, BrowserView as WebContentsView, BrowserContents as WebContents } from './browser-native'
import { browserURL, type BrowserShortcut } from './browser-utils'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const remote = require('@electron/remote')

const COVERAGE_INTERVAL = 100
// Tabby's bundled mainModule has no require; createRequire stays in the main process.
const browserHost = () => remote.getGlobal('process').getBuiltinModule('module').createRequire(resolve(__dirname, 'browser-host.cjs'))(resolve(__dirname, 'browser-host.cjs'))

/** @hidden */
@Component({
    selector: 'workbench-browser-tab',
    template: `
      <div class="browser-tab">
        <div class="toolbar">
          <button title="后退" aria-label="后退" (click)="goBack()">←</button>
          <button title="前进" aria-label="前进" (click)="goForward()">→</button>
          <button title="刷新（F5）" aria-label="刷新网页" (click)="reload()">↻</button>
          <input #addressBar class="address-bar" type="text" aria-label="网页地址"
            [(ngModel)]="addressBarValue" (keydown.enter)="navigate()"
            placeholder="网址或本地 HTML 文件路径" spellcheck="false">
          <button title="打开" aria-label="打开网页地址" (click)="navigate()">打开</button>
          <button title="打开本地 HTML 文件" aria-label="打开本地 HTML 文件" (click)="chooseFile()">文件</button>
        </div>
        <div class="load-error" *ngIf="loadError" role="alert">
          <p>{{loadError}}</p><button (click)="reload()">重试</button>
        </div>
        <div class="empty-page" *ngIf="!viewCreated && !loadError">输入网址，或打开本地 HTML 文件</div>
        <div class="view-host" #host tabindex="-1"></div>
      </div>
    `,
    styles: [`
      :host,.browser-tab{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0}
      .browser-tab{position:relative;background:var(--theme-bg,#20252b)}
      .toolbar{display:flex;align-items:center;gap:4px;padding:4px;flex:none;border-bottom:1px solid #8884}
      .address-bar{flex:1;min-width:40px;background:#8881;color:inherit;border:1px solid #8885;border-radius:3px;padding:4px 6px;font:inherit;font-size:12px}
      button{color:inherit;background:transparent;border:0;padding:4px 6px;cursor:pointer;font:inherit;font-size:12px}
      button:hover{background:#8883}button:focus-visible{outline:1px solid currentColor}
      .view-host{flex:1;min-height:0;outline:none;margin:5px}
      .empty-page{position:absolute;top:45%;align-self:center;opacity:.6;font-size:13px;pointer-events:none}
      .load-error{padding:16px;overflow:auto;word-break:break-word;font-size:13px}
    `],
})
export class BrowserTabComponent extends BaseTabComponent implements AfterViewInit, OnDestroy {
    @Input() url = ''
    openSibling?: (url: string) => void
    workspaceShortcut?: (id: string) => void
    paneMenu?: () => void
    private disposed = false

    addressBarValue = ''
    viewCreated = false
    loadError: string | null = null

    @ViewChild('host') host!: ElementRef<HTMLElement>
    @ViewChild('addressBar') addressBarInput?: ElementRef<HTMLInputElement>

    private win?: BrowserWindow
    private view?: WebContentsView
    private boundsWatch = 0
    private lastCoverageCheck = 0
    private lastBounds = ''
    private attached = false
    private visible = false
    private gestures = new Set<string>()
    private overlayParked = false
    private viewFocused = false
    private claimingPaneFocus = false
    private subscriptions: Subscription[] = []

    constructor (@Inject(Injector) injector: Injector, @Inject(NgZone) private zone: NgZone, @Inject(AppService) private app: AppService, @Inject(HotkeysService) private hotkeys: HotkeysService, @Inject(PlatformService) private platform: PlatformService) {
        super(injector)
        this.setTitle('网页')
    }

    ngAfterViewInit (): void {
        this.addressBarValue = this.url

        this.subscriptions.push(this.visibility$.subscribe((visible: boolean) => {
            if (visible && this.url && !this.viewCreated) {
                try { this.url = browserURL(this.url); this.createView() } catch (e) { this.loadError = String(e) }
            }
            this.setVisible(visible)
        }))
        // Let xterm finish cancelling the navigation hotkey before moving input
        // into a different WebContents (which can synchronously reset DOM keys).
        this.subscriptions.push(this.focused$.subscribe(() => requestAnimationFrame(() => {
            if (!this.disposed) this.focusView()
        })))

        this.subscriptions.push(this.hotkeys.hotkey$.subscribe((hk: string) => {
            if (hk === 'rearrange-panes' && this.visible) {
                this.setGesture('rearrange', true)
            }
        }))
        this.subscriptions.push(this.hotkeys.hotkeyOff$.subscribe((hk: string) => {
            if (hk === 'rearrange-panes') {
                this.setGesture('rearrange', false)
            }
        }))
        this.subscriptions.push(this.app.tabDragActive$.subscribe((tab: BaseTabComponent | null) => {
            this.setGesture('drag', !!tab && this.visible)
        }))
        this.watchSpannerDrag()

        this.subscriptions.push(this.config.changed$.subscribe(() => this.updateShortcuts()))
    }

    navigate (): void {
        try { this.open(this.normalize(this.addressBarValue)) } catch (e) { this.loadError = String(e); this.applyViewVisibility() }
    }

    goBack (): void {
        if (this.view?.webContents.canGoBack()) this.view.webContents.goBack()
    }

    goForward (): void {
        if (this.view?.webContents.canGoForward()) this.view.webContents.goForward()
    }

    reload (): void {
        if (this.view) this.view.webContents.reload(); else this.navigate()
    }

    async getRecoveryToken (): Promise<RecoveryToken> {
        return {
            type: 'codex-workbench:browser',
            version: 1,
            url: this.url,
        }
    }

    destroy (): void {
        if (this.disposed) return
        this.disposed = true
        this.subscriptions.forEach(s => s.unsubscribe())
        this.subscriptions = []
        this.destroyView()
        super.destroy()
    }

    ngOnDestroy (): void { this.destroy(); super.ngOnDestroy() }

    async chooseFile (): Promise<void> {
        const result = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            title: '打开 HTML 文件', properties: ['openFile'],
            filters: [{ name: 'HTML 网页', extensions: ['html', 'htm'] }],
        })
        if (!this.disposed && !result.canceled && result.filePaths[0]) this.open(pathToFileURL(result.filePaths[0]).href)
    }

    focusAddress (): void {
        if (!this.visible || this.overlayParked) return
        remote.getCurrentWebContents().focus()
        this.addressBarInput?.nativeElement.focus()
        this.addressBarInput?.nativeElement.select()
    }

    private updateShortcuts (): void {
        if (!this.view) return
        const ids = ['new-tab', 'workbench-pane-next-tab', 'workbench-pane-previous-tab', 'workbench-pane-close-tab',
            ...Array.from({ length: 9 }, (_, i) => `tab-${i + 1}`),
            ...['left', 'right', 'up', 'down'].map(d => `workbench-pane-focus-${d}`)]
        const shortcuts: BrowserShortcut[] = []
        for (const id of ids) {
            const configured = this.config.store.hotkeys[id]
            for (const value of typeof configured === 'string' ? [configured] : configured ?? []) {
                const binding = Array.isArray(value) && value.length === 1 ? value[0] : value
                if (typeof binding === 'string' && !binding.includes(' ')) shortcuts.push({ id, binding })
            }
        }
        for (const binding of ['F5', 'Ctrl-R', 'Meta-R']) shortcuts.push({ id: 'browser-reload', binding })
        for (const binding of ['Ctrl-L', 'Meta-L']) shortcuts.push({ id: 'browser-address', binding })
        browserHost().setBrowserShortcuts(this.view, shortcuts)
    }

    private destroyView (): void {
        this.stopBoundsWatch()
        this.lastBounds = ''
        if (this.view && this.attached) {
            try {
                this.win?.contentView.removeChildView(this.view)
            } catch { /* window already gone */ }
            try {
                this.view.webContents.close()
            } catch { /* already closed */ }
        }
        this.attached = false
        this.view = undefined
        this.win = undefined
        this.gestures.clear()
        this.overlayParked = false
        this.viewFocused = false
        this.claimingPaneFocus = false
    }

    private open (value: string): void {
        if (!value || this.disposed) {
            return
        }
        this.loadError = null
        this.url = value
        this.addressBarValue = value
        if (!this.viewCreated) {
            this.createView()
        } else {
            this.view?.webContents.loadURL(value).catch(() => { /* handled via did-fail-load */ })
            this.applyViewVisibility()
        }
        this.blurOwnInputs()
        this.takeKeyboard()
    }

    private normalize (input: string): string { return browserURL(input) }

    private createView (): void {
        if (this.viewCreated || !this.host) {
            return
        }
        this.win = remote.getCurrentWindow() as BrowserWindow
        this.view = browserHost().createBrowserView(this.win) as WebContentsView
        this.win.contentView.addChildView(this.view)
        this.attached = true
        this.viewCreated = true

        const wc: WebContents = this.view.webContents
        wc.on('did-navigate', (_e, url) => this.zone.run(() => this.onNavigated(url)))
        wc.on('did-navigate-in-page', (_e, url) => this.zone.run(() => this.onNavigated(url)))
        wc.on('page-title-updated', (_e, title) => this.zone.run(() => this.setTitle(title || '网页')))
        wc.on('did-start-loading', () => this.zone.run(() => this.clearLoadError()))
        wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (errorCode === -3 || !isMainFrame) {
                return
            }
            this.zone.run(() => {
                this.loadError = `无法加载 ${validatedURL || this.url}：${errorDescription} (${errorCode})`
                this.applyViewVisibility()
            })
        })
        wc.on('workbench-shortcut', id => this.zone.run(() => {
            if (!this.visible || this.overlayParked || !this.hotkeys.isEnabled()) return
            if (id === 'browser-reload') this.reload()
            else if (id === 'browser-address') this.focusAddress()
            else this.workspaceShortcut?.(id)
        }))
        wc.on('workbench-open-url', url => this.zone.run(() => this.openSibling?.(url)))
        wc.on('context-menu', (_event, params) => this.zone.run(() => {
            const items = []
            if (params.isEditable) items.push({ label: '剪切', click: () => wc.cut() })
            if (params.selectionText || params.isEditable) items.push({ label: '复制', click: () => wc.copy() })
            if (params.isEditable) items.push({ label: '粘贴', click: () => wc.paste() })
            if (params.linkURL && (/^https?:/i.test(params.linkURL) || (this.url.startsWith('file:') && /^file:/i.test(params.linkURL)))) items.push({ label: '在此分屏新标签打开链接', click: () => this.openSibling?.(params.linkURL) })
            items.push({ label: '刷新网页', click: () => this.reload() })
            if (this.paneMenu) items.push({ label: '分屏与标签…', click: () => this.paneMenu?.() })
            this.platform.popupContextMenu(items)
        }))
        wc.on('render-process-gone', () => this.zone.run(() => {
            if (!this.disposed) { this.loadError = '网页进程已退出，请刷新重试'; this.applyViewVisibility() }
        }))
        this.updateShortcuts()
        wc.on('focus', () => {
            this.viewFocused = true
            this.blurOwnInputs()
            this.claimPaneFocus()
        })
        wc.on('blur', () => {
            this.viewFocused = false

        })

        wc.loadURL(this.url).catch(() => { /* handled via did-fail-load */ })

        if (this.visible) this.startBoundsWatch()
        this.applyViewVisibility()
        if (this.hasFocus) this.focusView()
    }

    private ownInput (): HTMLInputElement | null {
        const active = document.activeElement
        if (active && active === this.addressBarInput?.nativeElement) {
            return active as HTMLInputElement
        }
        return null
    }

    private focusView (): void {
        if (this.claimingPaneFocus || this.overlayParked || !this.visible || this.ownInput()) {
            return
        }
        const parent = this.splitParent
        if (this.app.activeTab !== this.topmostParent || (parent && parent.getFocusedTab() !== this.splitLeaf)) {
            return
        }
        if (!this.view) this.focusAddress(); else this.takeKeyboard()
    }

    private takeKeyboard (): void {
        if (this.viewFocused || this.overlayParked) {
            return
        }
        this.view?.webContents.focus()
    }

    private blurOwnInputs (): void {
        this.zone.run(() => this.ownInput()?.blur())
    }

    private claimPaneFocus (): void {
        const parent = this.splitParent
        if (!parent || parent.getFocusedTab() === this.splitLeaf || this.gestures.has('resize')) {
            return
        }
        this.claimingPaneFocus = true
        try {
            this.zone.run(() => parent.focus(this.splitLeaf))
        } finally {
            this.claimingPaneFocus = false
        }
    }

    private get splitParent (): SplitTabComponent | null {
        return this.splitLeaf.parent instanceof SplitTabComponent ? this.splitLeaf.parent : null
    }

    private get splitLeaf (): BaseTabComponent {
        let tab: BaseTabComponent = this
        while (tab.parent && !(tab.parent instanceof SplitTabComponent)) tab = tab.parent
        return tab
    }

    private watchSpannerDrag (): void {
        this.addEventListenerUntilDestroyed(document.documentElement, 'mousedown', (event: Event) => {
            if (this.visible && (event.target as Element | null)?.closest?.('split-tab-spanner')) {
                this.setGesture('resize', true)
            }
        }, true)
        this.addEventListenerUntilDestroyed(document.documentElement, 'mouseup', () => {
            this.setGesture('resize', false)
        }, true)
    }

    private setGesture (name: string, active: boolean): void {
        if (active === this.gestures.has(name)) {
            return
        }
        if (active) {
            this.gestures.add(name)
        } else {
            this.gestures.delete(name)
        }
        this.syncOverlay()
    }

    private isCovered (): boolean {
        const host = this.host?.nativeElement
        if (!host || !this.visible || !this.view || this.loadError) {
            return false
        }
        if (document.querySelector('ngb-modal-window, .modal.show, .modal-backdrop')) return true
        const r = host.getBoundingClientRect()
        if (!r.width || !r.height) {
            return false
        }
        const inset = 2
        const xs = [r.left + inset, r.left + r.width / 2, r.right - inset]
        const ys = [r.top + inset, r.top + r.height / 2, r.bottom - inset]
        for (const x of xs) {
            for (const y of ys) {
                const onTop = document.elementFromPoint(x, y)
                if (onTop && !host.contains(onTop)) {
                    return true
                }
            }
        }
        return false
    }

    private syncOverlay (): void {
        if (!this.visible) return
        const gesture = this.gestures.size > 0
        const parked = gesture || this.isCovered()
        if (parked === this.overlayParked) {
            return
        }
        if (parked && this.viewFocused) {
            (remote.getCurrentWebContents() as WebContents).focus()
            if (gesture) {
                this.host?.nativeElement.focus()
            }
        }
        this.overlayParked = parked
        this.applyViewVisibility()
        if (!parked) {
            this.focusView()
        }
    }

    private onNavigated (url: string): void {
        this.addressBarValue = url
        this.url = url
        this.recoveryStateChangedHint.next()
    }

    private clearLoadError (): void {
        if (this.loadError === null) {
            return
        }
        this.loadError = null
        this.applyViewVisibility()
    }

    private startBoundsWatch (): void {
        if (this.boundsWatch) {
            return
        }
        this.zone.runOutsideAngular(() => {
            const tick = () => {
                this.boundsWatch = requestAnimationFrame(tick)
                const now = performance.now()
                if (now - this.lastCoverageCheck >= COVERAGE_INTERVAL) {
                    this.lastCoverageCheck = now
                    this.syncOverlay()
                }
                this.updateBounds()
            }
            this.boundsWatch = requestAnimationFrame(tick)
        })
    }

    private stopBoundsWatch (): void {
        cancelAnimationFrame(this.boundsWatch)
        this.boundsWatch = 0
    }

    private updateBounds (): void {
        if (!this.view || !this.host) {
            return
        }
        const r = this.host.nativeElement.getBoundingClientRect()
        const key = `${r.left} ${r.top} ${r.width} ${r.height} ${this.overlayParked}`
        if (key === this.lastBounds) {
            return
        }
        this.lastBounds = key
        const z = (remote.getCurrentWebContents() as WebContents).getZoomFactor()
        const width = Math.round(r.width * z)
        const x = this.overlayParked ? -width - 1000 : Math.round(r.left * z)
        this.view.setBounds({
            x,
            y: Math.round(r.top * z),
            width,
            height: Math.round(r.height * z),
        })
    }

    private setVisible (visible: boolean): void {
        this.visible = visible
        this.syncOverlay()
        if (visible && this.view) {
            this.startBoundsWatch()
        } else {
            this.stopBoundsWatch()
        }
        this.applyViewVisibility()
    }

    private applyViewVisibility (): void {
        if (!this.view) {
            return
        }
        const show = this.visible && !this.loadError && !this.overlayParked
        this.view.setVisible(show)
        if (show) {
            this.updateBounds()
        }
    }
}

@Injectable()
export class BrowserRecovery extends TabRecoveryProvider<BrowserTabComponent> {
    async applicableTo(token: RecoveryToken) { return token.type === 'codex-workbench:browser' && token.version === 1 }
    async recover(token: RecoveryToken) {
        return { type: BrowserTabComponent, inputs: { url: typeof token.url === 'string' ? token.url : '' } }
    }
}
