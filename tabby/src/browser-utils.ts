import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function browserURL(input: string): string {
  const value = input.trim();
  if (!value) return '';
  if (isAbsolute(value)) return pathToFileURL(value).href;
  const candidate = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)
    ? `http://${value}` : /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('仅支持 HTTP、HTTPS 和本地 HTML 文件');
  return url.href;
}

export interface BrowserInput {
  type: string; key: string; code: string;
  control: boolean; alt: boolean; shift: boolean; meta: boolean; isAutoRepeat?: boolean;
}
export type BrowserShortcut = { id: string; binding: string };

/** Match Tabby's single-stroke bindings without depending on its Angular renderer. */
export function browserShortcut(input: BrowserInput, bindings: BrowserShortcut[]): string | undefined {
  const aliases: Record<string, string> = {
    control: 'ctrl', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
    command: 'meta', cmd: 'meta', super: 'meta', option: 'alt',
  };
  const key = /^Digit[1-9]$/.test(input.code) ? input.code.slice(-1) : input.key.toLowerCase();
  const parts = [input.control && 'ctrl', input.alt && 'alt', input.shift && 'shift', input.meta && 'meta', aliases[key] || key].filter(Boolean).sort().join('-');
  return bindings.find(({ binding }) => binding.split('-').map(k => aliases[k.toLowerCase()] || k.toLowerCase()).sort().join('-') === parts)?.id;
}
