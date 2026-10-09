import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeFile, runWriterCli } from './patcher.js';
import { handleChemxWrite } from './mcp/tools-write.js';

const makeProject = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-write-safety-')));

const captureStderr = (fn) => {
  const original = process.stderr.write.bind(process.stderr);
  const originalOut = process.stdout.write.bind(process.stdout);
  let text = '';
  process.stderr.write = (chunk) => { text += chunk; return true; };
  process.stdout.write = () => true;
  try {
    return { result: fn(), text };
  } finally {
    process.stderr.write = original;
    process.stdout.write = originalOut;
  }
};

test('CLI write: missing --content refuses and never truncates', () => {
  const dir = makeProject();
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/keep.ts'), 'line1\nline2\n');
    process.chdir(dir);
    const { result, text } = captureStderr(() => runWriterCli(['src/keep.ts'], false));
    assert.equal(result, null);
    assert.match(text, /--content/);
    assert.equal(fs.readFileSync(path.join(dir, 'src/keep.ts'), 'utf-8'), 'line1\nline2\n');
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI write: --content <value> (space form) writes the value; existing files need --overwrite', () => {
  const dir = makeProject();
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const created = captureStderr(() => runWriterCli(['src/new.ts', '--content', 'export const a = 1;\n'], false));
    assert.equal(created.result.created, true);
    assert.equal(fs.readFileSync(path.join(dir, 'src/new.ts'), 'utf-8'), 'export const a = 1;\n');

    const refused = captureStderr(() => runWriterCli(['src/new.ts', '--content=export const a = 2;\n'], false));
    assert.equal(refused.result, null);
    assert.match(refused.text, /--overwrite/);

    const replaced = captureStderr(() => runWriterCli(['src/new.ts', '--content=export const a = 2;\n', '--overwrite'], false));
    assert.equal(replaced.result.created, false);
    assert.equal(fs.readFileSync(path.join(dir, 'src/new.ts'), 'utf-8'), 'export const a = 2;\n');
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write: unparseable content is refused', () => {
  const dir = makeProject();
  try {
    assert.throws(() => writeFile('src/bad.ts', { content: 'export const = ;', cwd: dir, skipIndex: true }), /does not parse/);
    assert.equal(fs.existsSync(path.join(dir, 'src/bad.ts')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write: a symlinked parent directory cannot escape the workspace (lib and MCP)', () => {
  const root = makeProject();
  const outside = makeProject();
  try {
    fs.symlinkSync(outside, path.join(root, 'escape'));
    assert.throws(() => writeFile('escape/pwned.ts', { content: 'x', cwd: root, skipIndex: true }), /Path traversal rejected/);
    assert.throws(() => writeFile('escape/deep/new/a.ts', { content: 'x', cwd: root, skipIndex: true }), /Path traversal rejected/);
    assert.throws(() => handleChemxWrite({ path: 'escape/mcp.ts', content: 'x' }, root), /Path traversal rejected/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('MCP write: honors dryRun and overwrite', () => {
  const dir = makeProject();
  try {
    const dry = handleChemxWrite({ path: 'src/a.ts', content: 'export const a = 1;\n', dryRun: true }, dir);
    assert.equal(dry.dryRun, true);
    assert.match(dry.diff, /^--- \/dev\/null/);
    assert.equal(fs.existsSync(path.join(dir, 'src/a.ts')), false);

    handleChemxWrite({ path: 'src/a.ts', content: 'export const a = 1;\n' }, dir);
    assert.throws(() => handleChemxWrite({ path: 'src/a.ts', content: 'export const a = 2;\n' }, dir), /overwrite/);
    handleChemxWrite({ path: 'src/a.ts', content: 'export const a = 2;\n', overwrite: true }, dir);
    assert.equal(fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf-8'), 'export const a = 2;\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI write: --content followed by a flag is a missing value, never the flag text', () => {
  const dir = makeProject();
  const cwd = process.cwd();
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Title\n\nImportant docs\n');
    fs.writeFileSync(path.join(dir, 'script.js'), 'console.log(1)\n');
    process.chdir(dir);
    for (const file of ['README.md', 'script.js']) {
      const before = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { result, text } = captureStderr(() => runWriterCli([file, '--content', '--overwrite'], false));
      assert.equal(result, null, `${file} must be refused`);
      assert.match(text, /--content/);
      assert.equal(fs.readFileSync(path.join(dir, file), 'utf-8'), before);
    }
    const inline = captureStderr(() => runWriterCli(['dash.md', '--content=--overwrite'], false));
    assert.equal(inline.result.created, true);
    assert.equal(fs.readFileSync(path.join(dir, 'dash.md'), 'utf-8'), '--overwrite');
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
