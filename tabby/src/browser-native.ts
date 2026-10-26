// Narrow structural types for the host Electron API. Electron is supplied by Tabby,
// so installing a second Electron runtime just for this plugin is unnecessary.
export interface BrowserContents {
  on(event: string, listener: (...args: any[]) => void): void;
  loadURL(url: string): Promise<void>;
  close(): void;
  isDestroyed(): boolean;
  isFocused(): boolean;
  focus(): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getZoomFactor(): number;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
}
export interface BrowserView {
  webContents: BrowserContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}
export interface BrowserWindow {
  contentView: { addChildView(view: BrowserView): void; removeChildView(view: BrowserView): void };
}
