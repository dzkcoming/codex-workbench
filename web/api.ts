export async function api(path: string, value?: any) {
  const res = await fetch(path, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
  return result;
}
export const rpc = (method: string, params: any = {}) => api('/api/terminal', { method, params });
export const operationId = () => globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const short = (s: string | null | undefined) => s?.slice(0, 8) || '—';
export const plain = (s: string) => s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
export const states: Record<string, string> = { connected: '已连接', connecting: '连接中', disconnected: '已断开', error: '异常', stopped: '未启动', ready: '就绪', starting: '启动中', sent: '已发送', unknown: '结果未知', cancelled: '已取消', writing: '发送中', queued: '排队中' };
export type TerminalInfo = { id: string; workspace_id: string; name: string; kind: string; state: string; session_id: string; model_write: boolean; error: string | null; config: any };
export type Jump = { terminal: string; session: string; start: number; end: number; nonce: number };
