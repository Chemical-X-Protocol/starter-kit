import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTokenOptimized } from './reader.js';

const LONG = 150;

const withFiles = (files, body) => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-read-plain-')));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel), content);
    }
    return body(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

const rows = (count, make) => Array.from({ length: count }, (_, i) => make(i + 1)).join('\n') + '\n';

describe('chemx read on a long file with no code outline', () => {
  it('returns the first window of text for yaml, json and txt, not an empty outline', () => {
    const files = {
      'ci.yml': rows(LONG, (n) => `key${n}: value${n}`),
      'data.json': `{\n${rows(LONG - 2, (n) => `  "k${n}": ${n},`)}  "end": 0\n}\n`,
      'notes.txt': rows(LONG, (n) => `note line ${n}`)
    };
    withFiles(files, (cwd) => {
      for (const name of Object.keys(files)) {
        const res = readTokenOptimized(name, { cwd, hintSyntax: 'cli' });
        assert.equal(res.mode, 'range', name);
        assert.equal(res.totalLines, files[name].replace(/\n$/, '').split('\n').length, name);
        assert.equal(res.startLine, 1, name);
        assert.equal(res.endLine, 100, `${name} is capped at the read window`);
        assert.equal(res.lineCount, 100, name);
        assert.match(res.trailer, /Truncated at the 100-line chemx read window/, name);
        assert.match(res.trailer, new RegExp(`chemx read ${name}:101-`), `${name} names the next range`);
      }
      assert.match(readTokenOptimized('ci.yml', { cwd }).content, /^key1: value1\nkey2: value2/);
    });
  });

  it('reads text for any extension that has no outline extractor (shell, sql, html), and for a Markdown file with no headings', () => {
    const files = {
      'run.sh': rows(LONG, (n) => `echo ${n}`),
      'q.sql': rows(LONG, (n) => `select ${n};`),
      'page.html': rows(LONG, (n) => `<p>${n}</p>`),
      'prose.md': rows(LONG, (n) => `sentence number ${n} without any heading`)
    };
    withFiles(files, (cwd) => {
      for (const name of Object.keys(files)) {
        const res = readTokenOptimized(name, { cwd });
        assert.equal(res.mode, 'range', name);
        assert.equal(res.lineCount, 100, name);
      }
    });
  });

  it('keeps the outline for code and for Markdown that has headings', () => {
    const files = {
      'mod.js': rows(LONG, (n) => `export const value${n} = ${n};`),
      'doc.md': `# Title\n\n${rows(LONG, (n) => (n % 50 === 0 ? `## Section ${n}` : `text ${n}`))}`,
      'style.scss': rows(LONG, (n) => `@mixin m${n} { color: red; }`)
    };
    withFiles(files, (cwd) => {
      for (const name of Object.keys(files)) assert.equal(readTokenOptimized(name, { cwd }).mode, 'auto-outline', name);
      assert.match(readTokenOptimized('doc.md', { cwd }).content, /L1 {2}# Title/);
    });
  });

  it('reads a short text file whole and honours an explicit range, as before', () => {
    withFiles({ 'short.yml': rows(10, (n) => `k${n}: ${n}`), 'long.yml': rows(LONG, (n) => `k${n}: ${n}`) }, (cwd) => {
      const whole = readTokenOptimized('short.yml', { cwd });
      assert.equal(whole.mode, 'range');
      assert.equal(whole.lineCount, 10);
      assert.equal(whole.trailer, undefined);
      const slice = readTokenOptimized('long.yml:120-125', { cwd });
      assert.equal(slice.startLine, 120);
      assert.equal(slice.endLine, 125);
      assert.match(slice.content, /^k120: 120/);
    });
  });
});
