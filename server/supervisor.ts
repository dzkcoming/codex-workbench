import { spawn, type ChildProcess } from 'node:child_process';
import { root } from './config.js';
import { join } from 'node:path';
import { terminalCall } from './http.js';

if (process.env.AI_ENTRY_LAUNCH !== '1' && !process.argv.includes('--allow-standalone')) {
  console.error('请通过 AI Entry Portal 启动，或仅在本地调试时使用 --allow-standalone'); process.exit(1);
}
let stopping = false;
const children = new Map<string, ChildProcess>();
const args = process.argv.slice(2).filter(a => a !== '--allow-standalone');
function launch(name: string, extra: string[] = []) {
  if (stopping) return;
  const child = spawn(process.execPath, [join(root, `dist/server/${name}.js`), ...extra], { cwd: root, stdio: 'inherit', env: process.env });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (!stopping) { console.error(`${name} exited (${code}/${signal}); restarting in 2s`); setTimeout(() => launch(name, extra), 2000); }
  });
}
launch('terminal-service');
for (let n = 0; n < 100; n++) {
  try { await terminalCall('health', {}, 500); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
}
launch('app', args);
async function stop() {
  if (stopping) return; stopping = true;
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children.values()) child.kill('SIGKILL'); process.exit(0); }, 2500);
  if (!children.size) process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
