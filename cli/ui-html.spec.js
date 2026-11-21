import test from 'node:test';
import assert from 'node:assert';
import { generateSwarmHtml } from './ui-html.js';

const countOf = (text, needle) => text.split(needle).length - 1;

test('ui-html: $ patterns in hydrated state are injected literally, never expanded', () => {
  const plain = generateSwarmHtml({ t: 'plain' });
  for (const title of ["a$'b", 'a$&b', 'a$`b', 'a$$b']) {
    const html = generateSwarmHtml({ t: title });
    assert.strictEqual(countOf(html, '</html>'), countOf(plain, '</html>'), `${title} must not duplicate the document`);
    assert.ok(html.includes(JSON.stringify({ t: title })), `${title} is injected verbatim`);
  }
});

test('ui-html: inlines every component .css and .js in name order, after the hydrated state', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-ui-components-'));
  fs.writeFileSync(path.join(dir, 'b-card.js'), 'window.B = 1;');
  fs.writeFileSync(path.join(dir, '00-core.js'), 'window.CORE = "</script>";');
  fs.writeFileSync(path.join(dir, '00-core.css'), '.core{}');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'not inlined');
  const html = generateSwarmHtml({}, { componentsDir: dir });
  const order = ['__CHEMX_HYDRATED_STATE__', 'data-file="00-core.css"', 'data-file="00-core.js"', 'data-file="b-card.js"'].map((n) => html.indexOf(n));
  assert.ok(order.every((i) => i >= 0), 'state and all three files are present');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'state first, then files in name order');
  assert.ok(!html.includes('not inlined'), 'only .css and .js files are inlined');
  assert.ok(html.includes('window.CORE = "<\\/script>"'), 'a closing script tag inside a file is escaped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ui-html: the shipped components register on window.ChemxUi.components', () => {
  const html = generateSwarmHtml({});
  for (const name of ['xo-avatar', 'xo-timeline', 'xo-post-card', 'xo-agent-profile', 'xo-post-permalink']) {
    assert.ok(html.includes(`window.ChemxUi.components['${name}']`), `${name} is inlined`);
  }
  assert.ok(html.indexOf('data-file="00-core.js"') < html.indexOf('data-file="xo-avatar.js"'), 'core loads before components');
});
