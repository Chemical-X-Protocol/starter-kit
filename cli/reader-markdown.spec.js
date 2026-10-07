import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateAstOutline, readTokenOptimized } from './reader.js';

const FIXTURE = [
  '# Title',
  '',
  'Intro prose that mentions a function into the void.',
  '',
  '## Section A',
  '```js',
  '# not a heading',
  'function foo() {}',
  '```',
  '',
  '### Sub A.1',
  'Body.',
  '~~~',
  '## fenced with tildes',
  '~~~',
  '## Section B'
].join('\n');

describe('Reader Markdown outline', () => {
  it('outlines Markdown by heading with line numbers and skips fenced code', () => {
    const outline = generateAstOutline(FIXTURE, 'notes.md');
    const rows = outline.split('\n').slice(1).map((row) => row.replace(/\s+\(~\d+ tokens\)$/, ''));
    assert.deepStrictEqual(rows, ['L1  # Title', 'L5  ## Section A', 'L11  ### Sub A.1', 'L16  ## Section B']);
  });

  it('estimates tokens per section so a reader can choose a slice', () => {
    const outline = generateAstOutline(FIXTURE, 'notes.md');
    assert.match(outline, /L5 {2}## Section A {2}\(~\d+ tokens\)/);
  });

  it('auto-outlines a long Markdown file by its headings, not by code symbols', () => {
    const res = readTokenOptimized('AGENTS.md');
    assert.match(res.content, /L1 {2}# Chemical X Molecular Architecture Directives/);
    assert.doesNotMatch(res.content, /^function into$/m);
    const headingCount = fs.readFileSync('AGENTS.md', 'utf8').split('\n').filter((line) => /^#{1,6} /.test(line)).length;
    assert.equal((res.content.match(/^L\d+ {2}#/gm) || []).length, headingCount);
  });
});
