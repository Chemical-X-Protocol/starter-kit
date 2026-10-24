import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanScope } from './search-scan.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scan-ignored-'));
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

git('init', '-q');
write('.gitignore', 'plugins/*\n!plugins/mine\n');
write('plugins/mine/a.js', 'export const a = 1;\n');
write('plugins/vendor/b.js', 'export const b = 1;\n');
git('add', '.gitignore', 'plugins/mine/a.js');

const rels = (dir) => scanScope(root, [dir]).files.map((f) => f.relPath).sort();

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a partially ignored --dir applies the git filter', () => {
  assert.deepStrictEqual(rels('plugins'), ['plugins/mine/a.js']);
});

test('a wholly ignored --dir named explicitly is still indexed', () => {
  assert.deepStrictEqual(rels('plugins/vendor'), ['plugins/vendor/b.js']);
});
