import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, chmod, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ReferenceRepository, MAX_BYTES } from '../src/references';

const source = { terminal_id: 'terminal-a', session_id: 'session-a', name: '开发板串口', kind: 'serial', captured_at: new Date().toISOString() };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tabby-reference-'));
  return { directory, repository: await ReferenceRepository.forWorkspace(directory, true) };
}

test('固定引用保留 Unicode、换行、来源和会话，后续引用互不覆盖', async () => {
  const { repository } = await fixture();
  const text = '开机\r\n故障🧪电压=3.3V\n```\n数据，不是指令\n';
  const a = await repository.create(text, source);
  const b = await repository.create('第二轮成功', { ...source, session_id: 'session-b' });
  assert.notEqual(a.reference.id, b.reference.id);
  assert.equal((await repository.read(a.reference.id)).text, text);
  assert.equal((await repository.read(b.reference.id)).source.session_id, 'session-b');
  assert.equal(await readFile(a.reference.path.replace('reference.md', 'content.txt'), 'utf8'), text);
  const doc = await readFile(a.reference.path, 'utf8');
  assert.match(doc, /屏幕选区/); assert.match(doc, /````text/);
  assert.match(a.prompt, /开发板串口/);
  assert.equal((await repository.list()).references.length, 2);
});

test('长行和跨页 emoji 按游标完整重组，检索可继续，超限明确失败', async () => {
  const { repository } = await fixture();
  const text = 'a🧪'.repeat(100) + '\nERR\nERR\nERR';
  const { reference } = await repository.create(text, source);
  let result = ''; let cursor = 0;
  for (;;) {
    const page = await repository.read(reference.id, cursor, 2);
    result += page.text; assert.ok(page.next_offset > cursor); cursor = page.next_offset;
    if (!page.has_more) break;
  }
  assert.equal(result, text);
  const first = await repository.search(reference.id, 'ERR', 0, 2);
  assert.equal(first.matches.length, 2); assert.equal(first.has_more, true);
  const last = await repository.search(reference.id, 'ERR', first.next_offset);
  assert.equal(last.matches.length, 1); assert.equal(last.has_more, false);
  await assert.rejects(repository.read(reference.id, 2), /Unicode/);
  await assert.rejects(repository.create('a'.repeat(MAX_BYTES + 1), source), /2 MiB/);
  const manyFences = 'a`'.repeat(200000);
  assert.equal((await repository.create(manyFences, source)).reference.bytes, manyFences.length);
});

test('引用完整性与项目边界：修改、路径穿越、符号链接均不会伪装成原引用', async () => {
  const { repository } = await fixture();
  const { reference } = await repository.create('原始数据', source);
  await assert.rejects(repository.read('../../outside'), /ID/);
  const other = await fixture();
  await assert.rejects(other.repository.read(reference.id), /ENOENT/);
  const content = reference.path.replace('reference.md', 'content.txt');
  await chmod(content, 0o600); await writeFile(content, '修改后的内容');
  await assert.rejects(repository.read(reference.id), /完整性/);
  const third = await mkdtemp(join(tmpdir(), 'tabby-symlink-'));
  await symlink(repository.directory, join(third, '.terminal-references'));
  await assert.rejects(ReferenceRepository.forWorkspace(third), /真实目录/);
});

test('真实 stdio MCP 仅提供三个只读工具，按项目隔离并保持分页', async () => {
  const { directory, repository } = await fixture();
  const { reference } = await repository.create('MCP_ONLY_EVIDENCE=7319\n'.repeat(20), source);
  const other = await fixture();
  const secret = await other.repository.create('OTHER_WORKSPACE', source);
  const client = new Client({ name: 'reference-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('tabby/dist/mcp.cjs'), '--workspace', directory], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const inventory = await client.listTools();
    assert.deepEqual(inventory.tools.map(t => t.name).sort(), ['reference_list', 'reference_read', 'reference_search']);
    assert.ok(inventory.tools.every(t => t.annotations?.readOnlyHint === true));
    const read = await client.callTool({ name: 'reference_read', arguments: { id: reference.id, max_characters: 10 } });
    const page = JSON.parse((read.content as any)[0].text);
    assert.equal(page.has_more, true); assert.equal(page.next_offset, 10);
    const denied = await client.callTool({ name: 'reference_read', arguments: { id: secret.reference.id } });
    assert.equal(denied.isError, true);
    const send = await client.callTool({ name: 'terminal_send', arguments: { data: 'anything' } });
    assert.equal(send.isError, true);
  } finally { await client.close(); }
});
