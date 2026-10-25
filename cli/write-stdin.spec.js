/**
 * `chemx write <file> <<'EOF'` needs no --stdin (#6773): with no content argument a piped stdin is the
 * content. A stdin that is not piped, or that is empty, still refuses instead of writing nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const BODY = 'export const piped = true;\n';

const withProject = (fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-write-stdin-')));
  fs.mkdirSync(path.join(dir, '.chemx'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const write = (dir, args, options = {}) => spawnSync(process.execPath, [CLI, 'write', ...args, '--as=@spec-write'], { cwd: dir, encoding: 'utf-8', ...options });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('piped stdin with no content argument is the content', () => {
  withProject((dir) => {
    const res = write(dir, ['src/a.js'], { input: BODY });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/a.js'), BODY);
  });
});

test('a stdin redirected from a file is the content too', () => {
  withProject((dir) => {
    fs.writeFileSync(path.join(dir, 'body.txt'), BODY);
    const fd = fs.openSync(path.join(dir, 'body.txt'), 'r');
    try {
      const res = write(dir, ['src/b.js'], { stdio: [fd, 'pipe', 'pipe'] });
      assert.equal(res.status, 0, res.stderr);
      assert.equal(read(dir, 'src/b.js'), BODY);
    } finally {
      fs.closeSync(fd);
    }
  });
});

test('--stdin and - keep working', () => {
  withProject((dir) => {
    assert.equal(write(dir, ['src/c.js', '--stdin'], { input: BODY }).status, 0);
    assert.equal(write(dir, ['src/d.js', '-'], { input: BODY }).status, 0);
    assert.equal(read(dir, 'src/c.js'), BODY);
    assert.equal(read(dir, 'src/d.js'), BODY);
  });
});

test('--content and --content-file win over a piped stdin', () => {
  withProject((dir) => {
    fs.writeFileSync(path.join(dir, 'from-file.txt'), 'export const fromFile = 1;\n');
    assert.equal(write(dir, ['src/e.js', '--content=export const inline = 1;\n'], { input: 'ignored\n' }).status, 0);
    assert.equal(write(dir, ['src/f.js', '--content-file=from-file.txt'], { input: 'ignored\n' }).status, 0);
    assert.equal(read(dir, 'src/e.js'), 'export const inline = 1;\n');
    assert.equal(read(dir, 'src/f.js'), 'export const fromFile = 1;\n');
  });
});

test('no content argument and no input (/dev/null) refuses and creates nothing', () => {
  withProject((dir) => {
    const res = write(dir, ['src/g.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /chemx write needs --content/);
    assert.equal(fs.existsSync(path.join(dir, 'src/g.js')), false);
  });
});

test('an empty pipe is not content: it refuses and creates nothing', () => {
  withProject((dir) => {
    const res = write(dir, ['src/h.js'], { input: '' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /chemx write needs --content/);
    assert.equal(fs.existsSync(path.join(dir, 'src/h.js')), false);
  });
});

test('the refusal text names the piped form', () => {
  withProject((dir) => {
    const res = write(dir, ['src/i.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(res.stderr, /pipe or redirect/);
  });
});

test('--stdin on an empty pipe still writes an empty file, as before', () => {
  withProject((dir) => {
    const res = write(dir, ['src/empty.txt', '--stdin'], { input: '' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/empty.txt'), '');
  });
});
