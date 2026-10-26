import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, chmod, writeFile, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReferenceRepository } from '../src/references';
import { BasketRepository } from '../src/basket';

const source = { terminal_id: 'a', session_id: 'a1', name: '编译', kind: 'local', captured_at: new Date().toISOString() };
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), 'reference-basket-'));
  const references = await ReferenceRepository.forWorkspace(project, true);
  return { project, references, basket: new BasketRepository(references) };
}

test('basket survives reopen, preserves multi-source notes/order, and removes only membership', async () => {
  const { project, references, basket } = await fixture();
  await basket.add('BUILD_FAILED\n```\n', source);
  await basket.add('BOOT_FAILED', { ...source, terminal_id: 'b', session_id: 'b1', name: '串口', kind: 'serial' });
  let view = await basket.view();
  const [a, b] = view.items;
  view = await basket.update('note', a.id, '复位前的编译结果', view.revision);
  view = await basket.update('up', b.id, '', view.revision);
  const reopened = new BasketRepository(await ReferenceRepository.forWorkspace(project));
  assert.deepEqual(await reopened.view(), view);
  const copied = await reopened.copy(view.revision);
  assert.match(copied.prompt, /复位前的编译结果/);
  assert.ok(copied.prompt.indexOf('BOOT_FAILED') < copied.prompt.indexOf('BUILD_FAILED'));
  assert.match(copied.prompt, /串口/);
  assert.match(copied.prompt, /````text/);
  view = await basket.update('remove', a.id, '', view.revision);
  view = await basket.update('clear', '', '', view.revision);
  assert.equal(view.items.length, 0);
  assert.equal((await references.list()).references.length, 2);
  await assert.rejects(basket.copy(view.revision), /为空/);
});

test('concurrent workers serialize writes; stale edits do not erase newly collected entries', async () => {
  const { references, basket } = await fixture();
  const otherWindow = new BasketRepository(references);
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? basket : otherWindow).add(`part-${i}`, source)));
  const first = await basket.view();
  assert.equal(first.items.length, 8);
  await otherWindow.add('later', source);
  await assert.rejects(basket.update('clear', '', '', first.revision), /已更新/);
  await assert.rejects(basket.copy(first.revision), /已更新/);
  assert.equal((await basket.view()).items.length, 9);
});

test('concurrent recovery of a crashed worker lock keeps every newly added entry', async () => {
  const { references, basket } = await fixture();
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  const lock = join(references.directory, '.basket.lock');
  await mkdir(lock);
  await writeFile(join(lock, 'owner-11111111-1111-1111-1111-111111111111'), String(child.pid));
  await Promise.all(Array.from({ length: 10 }, (_, i) => new BasketRepository(references).add(`after-crash-${i}`, source)));
  assert.equal((await basket.view()).items.length, 10);
  assert.equal((await references.list()).references.length, 10);
});

test('long content is linked in full, tampering fails copy, and project baskets stay separate', async () => {
  const { project, references, basket } = await fixture();
  const text = '日志🧪'.repeat(6000);
  await basket.add(text, source);
  const view = await basket.view();
  const result = await basket.copy(view.revision);
  assert.ok(result.prompt.length < 2000);
  assert.match(result.prompt, /未内联/);
  assert.match(result.prompt, /reference\.md/);
  const content = view.items[0].reference!.path.replace('reference.md', 'content.txt');
  assert.equal(await readFile(content, 'utf8'), text);
  assert.equal((await (await fixture()).basket.view()).items.length, 0);
  await chmod(content, 0o600); await writeFile(content, 'tampered');
  await assert.rejects(basket.copy(view.revision), /完整性/);
  const linkProject = await fixture();
  await symlink(join(project, '.terminal-references/basket.json'), join(linkProject.references.directory, 'basket.json'));
  await assert.rejects(linkProject.basket.view());
  assert.equal((await references.list()).references.length, 1);
});
