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
