import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { socketPath } from './config.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function body(req: IncomingMessage): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, '请求必须使用 application/json');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, '请求超过 1 MiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new HttpError(400, 'JSON 格式错误'); }
}
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function fail(res: ServerResponse, error: unknown) {
  json(res, { error: error instanceof Error ? error.message : String(error) }, error instanceof HttpError ? error.status : 500);
}
export function terminalCall<T = any>(method: string, params: unknown = {}, timeout = 35000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: '/rpc', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let result = ''; res.setEncoding('utf8');
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { const data = JSON.parse(result); if (res.statusCode !== 200) reject(new Error(data.error)); else resolve(data); }
        catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('终端服务请求超时；写入结果请查询 operation_id，勿自动重发')));
    req.on('error', reject); req.end(JSON.stringify({ method, params }));
  });
}
export function required(value: unknown, name: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name} 无效`);
  return value;
}
export function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new HttpError(400, `数值必须在 ${min} 到 ${max} 之间`);
  return n;
}
