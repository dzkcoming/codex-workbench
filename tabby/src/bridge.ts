import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

export class ReferenceBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextID = 0;
  private pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private idle?: ReturnType<typeof setTimeout>;

  private start() {
    if (this.child) return this.child;
    // Official Tabby builds can disable Electron's RunAsNode fuse. Use an independent Node runtime.
    const executable = process.env.TABBY_REFERENCE_NODE ?? resolve(__dirname, '../../.runtime/node_modules/node/bin/node');
    const child = spawn(executable, [join(__dirname, 'worker.cjs')], {
      env: process.env, stdio: 'pipe', windowsHide: true,
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        const request = this.pending.get(message.id); if (!request) return;
        clearTimeout(request.timer); this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
        if (!this.pending.size) this.idle = setTimeout(() => this.close(), 30000);
      } catch { this.fail(child, new Error('引用后台返回了无效响应')); }
    });
    child.stderr.on('data', () => { /* Never dump terminal contents into application logs. */ });
    child.on('error', error => this.fail(child, error));
    child.on('exit', () => { lines.close(); this.fail(child, new Error('引用后台已退出，可重新尝试')); });
    child.stdin.on('error', error => this.fail(child, error));
    return child;
  }

  request<T = any>(workspace: string, method: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.pending.size >= 4) return Promise.reject(new Error('引用任务正在处理，请稍后重试'));
    clearTimeout(this.idle);
    const child = this.start(); const id = ++this.nextID;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(child, new Error('引用处理超过 15 秒，请在引用目录检查结果后重试')), 15000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...data, id, workspace, method }) + '\n');
    });
  }
  private fail(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return;
    this.child = null; clearTimeout(this.idle);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); child.kill();
  }
  close() { if (this.child) this.fail(this.child, new Error('引用后台已关闭')); }
}
