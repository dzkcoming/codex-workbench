import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { browserURL, browserShortcut, type BrowserInput } from '../src/browser-utils';

test('browser addresses accept local tools/files and reject executable schemes', () => {
  assert.equal(browserURL('localhost:10000'), 'http://localhost:10000/');
  assert.equal(browserURL('127.0.0.1:10000/report'), 'http://127.0.0.1:10000/report');
  assert.equal(browserURL('example.org/help'), 'https://example.org/help');
  const path = "/tmp/报告 '第一份' #1.html";
  assert.equal(browserURL(path), pathToFileURL(path).href);
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'devtools://test', 'ftp://example.org']) {
    assert.throws(() => browserURL(value));
  }
});

test('only configured exact shortcuts are intercepted; regular webpage editing is preserved', () => {
  const input: BrowserInput = { type: 'keyDown', key: 'T', code: 'KeyT', control: true, shift: true, alt: false, meta: false };
  const bindings = [{ id: 'new-tab', binding: 'Ctrl-Shift-T' }, { id: 'right', binding: 'Alt-Right' }];
  assert.equal(browserShortcut(input, bindings), 'new-tab');
  assert.equal(browserShortcut({ ...input, shift: false }, bindings), undefined);
  assert.equal(browserShortcut({ ...input, alt: true }, bindings), undefined);
  assert.equal(browserShortcut({ ...input, key: 'ArrowRight', code: 'ArrowRight', control: false, shift: false, alt: true }, bindings), 'right');
  assert.equal(browserShortcut({ ...input, key: 'c', code: 'KeyC', shift: false }, bindings), undefined);
  assert.equal(browserShortcut(input, [{ id: 'new-tab', binding: 'Ctrl-Shift-Y' }]), undefined);
});
