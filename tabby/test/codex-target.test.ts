import test from 'node:test';
import assert from 'node:assert/strict';
import { composerReady, pastePacket, probeCodex } from '../src/codex-target';

test('only a visible bracketed-paste composer near the cursor is eligible', () => {
  const lines = ['old output', '', '› my existing draft', '', 'model · directory', 'tab to queue message'];
  assert.equal(composerReady(lines, 2, true, true), true);
  const multiline = ['› first line', ...Array(16).fill('draft continues'), '', 'GPT-6 · project', 'for shortcuts'];
  assert.equal(composerReady(multiline, 17, true, true), true);
  assert.equal(composerReady(['›', 'pasted text', '', 'GPT-6 · project'], 2, true, true), true);
  assert.equal(composerReady(lines, 2, false, true), false);
  assert.equal(composerReady(lines, 2, true, false), false);
  assert.equal(composerReady(['Would you like to run this command?', '› 1. Yes', '2. No'], 1, true, true), false);
  assert.equal(composerReady(['Select a model', '› 1. GPT'], 1, true, true), false);
  assert.equal(composerReady(['› /model', 'choose a command'], 0, true, true), false);
  assert.equal(composerReady(['› draft', 'esc to interrupt'], 0, true, true), false);
  assert.equal(composerReady(['› old output', ...Array(15).fill('other screen')], 12, true, true), false);
});

test('quoted control bytes cannot terminate a bracketed paste or emit an enter outside it', () => {
  const packet = pastePacket('a\r\nb\x1b[201~\rmalicious\x03\x9b201~');
  assert.ok(packet.startsWith('\x1b[200~\n') && packet.endsWith('\n\x1b[201~'));
  const body = packet.slice(6, -6);
  assert.ok(!body.includes('\x1b') && !body.includes('\r') && !body.includes('\x03') && !body.includes('\x9b'));
  assert.match(body, /\\x1b\[201~/);
});

test('invalid roots and this non-Codex process are not eligible targets', async () => {
  assert.equal(await probeCodex(-1), null);
  assert.equal(await probeCodex(process.pid), null);
});
