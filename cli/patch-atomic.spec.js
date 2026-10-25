// K19 (#6768): a multi-block patch is all-or-nothing, and a refusal names the block that caused it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleChemxPatch } from './mcp/tools-patch.js';
import { handleChemxWrite } from './mcp/tools-write.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
// Markers are built, never written at column 0, so this spec never reads as an unmerged file.
const OPEN = `${'<'.repeat(7)} SEARCH`;
const MID = '='.repeat(7);
const CLOSE = `${'>'.repeat(7)} REPLACE`;
const block = (search, replace) => [OPEN, search, MID, replace, CLOSE].join('\n');
const deletion = (search) => [OPEN, search, MID, CLOSE].join('\n');

const ABC = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';

const withProject = (files, fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-atomic-')));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const run = (dir, args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input, encoding: 'utf-8' });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');
const hasBackup = (dir) => fs.existsSync(path.join(dir, '.chemx', 'backups'));
const threeBlocks = (second, third = block('const c = 3;', 'const c = 30;')) => [block('const a = 1;', 'const a = 10;'), second, third].join('\n');

test('patch: a three-block patch whose second block removes a declaration writes nothing and names block 2', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts'], threeBlocks(deletion('const b = 2;')));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 2 of 3: src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.match(res.stderr, /--allow-remove=b/);
    assert.match(res.stderr, /[Nn]othing was written/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    assert.equal(hasBackup(dir), false);
  });
});

test('patch: a three-block patch with a non-matching third block applies nothing and names block 3', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts'], threeBlocks(block('const b = 2;', 'const b = 20;'), block('const nope = 3;', 'const nope = 30;')));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 3 of 3/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    assert.equal(hasBackup(dir), false);
  });
});

test('patch: --allow-remove still applies all three blocks', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts', '--allow-remove=b'], threeBlocks(deletion('const b = 2;')));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 10;\nconst c = 30;\n');
    assert.match(res.stdout, /3 blocks/);
  });
});

test('patch: the block that takes the declaration away is blamed, not the first block or the last', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const input = [block('const a = 1;', 'const a = 10;'), block('const b = 2;', 'const b = 20;'), deletion('const c = 3;')].join('\n');
    const res = run(dir, ['patch', 'src/m.ts'], input);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 3 of 3: src\/m\.ts: would remove top-level declaration\(s\) c/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
  });
});

test('patch: when two blocks each remove a declaration the first one is blamed and the reason lists both', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const input = [block('const a = 1;', 'const a = 10;'), deletion('const b = 2;'), deletion('const c = 3;')].join('\n');
    const res = run(dir, ['patch', 'src/m.ts'], input);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 2 of 3: src\/m\.ts: would remove top-level declaration\(s\) b, c/);
    assert.match(res.stderr, /--allow-remove=b,c/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
  });
});

test('patch: a later block that puts the removed declaration back makes the patch whole again', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const input = [deletion('const b = 2;'), block('const c = 3;', 'const b = 22;\nconst c = 3;')].join('\n');
    const res = run(dir, ['patch', 'src/m.ts'], input);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 1;\nconst b = 22;\nconst c = 3;\n');
  });
});

test('patch: a block that breaks the syntax is blamed, and a later block that mends it makes the patch pass', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const breaks = block('const b = 2;', 'const b = (2;');
    const refused = run(dir, ['patch', 'src/m.ts'], threeBlocks(breaks));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Block 2 of 3: src\/m\.ts: result does not parse/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    const mends = block('const c = 3;', 'const c = 3;\nconst d = 4;\nconst b2 = 2;');
    const input = [breaks, block('const b = (2;', 'const b = 2;'), mends].join('\n');
    const ok = run(dir, ['patch', 'src/m.ts'], input);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst b2 = 2;\n');
  });
});

test('patch: a block that adds an import of a missing module is blamed and nothing is written', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts'], threeBlocks(block('const b = 2;', "import './nope.js';\nconst b = 2;")));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 2 of 3: src\/m\.ts: imports \.\/nope\.js/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
  });
});

test('patch --dry-run: the same refusal, the file untouched', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts', '--dry-run'], threeBlocks(deletion('const b = 2;')));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Block 2 of 3: src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
  });
});

test('patch: a single block keeps the plain refusal text, with no block number', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const res = run(dir, ['patch', 'src/m.ts'], deletion('const b = 2;'));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.doesNotMatch(res.stderr, /Block 1/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
  });
});

test('MCP patch: blocks[] whose second block trips the declaration guard throws naming block 2 and writes nothing', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const blocks = [
      { search: 'const a = 1;', replace: 'const a = 10;' },
      { search: 'const b = 2;', replace: '' },
      { search: 'const c = 3;', replace: 'const c = 30;' }
    ];
    assert.throws(() => handleChemxPatch({ path: 'src/m.ts', blocks }, dir), /Block 2 of 3: src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    assert.equal(hasBackup(dir), false);
    const ok = handleChemxPatch({ path: 'src/m.ts', blocks, allowRemoved: ['b'] }, dir);
    assert.equal(ok.blocks, 3);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 10;\nconst c = 30;\n');
  });
});

test('write --overwrite: a refused overwrite leaves the file byte-identical, and --allow-remove lets it through', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const refused = run(dir, ['write', 'src/m.ts', '--overwrite', '--content=const a = 1;\nconst c = 3;\n']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    assert.equal(hasBackup(dir), false);
    const ok = run(dir, ['write', 'src/m.ts', '--overwrite', '--allow-remove=b', '--content=const a = 1;\nconst c = 3;\n']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(read(dir, 'src/m.ts'), 'const a = 1;\nconst c = 3;\n');
  });
});

test('MCP write: a refused overwrite throws and leaves the file byte-identical', () => {
  withProject({ 'src/m.ts': ABC }, (dir) => {
    const args = { path: 'src/m.ts', overwrite: true, content: 'const a = 1;\nconst c = 3;\n' };
    assert.throws(() => handleChemxWrite(args, dir), /src\/m\.ts: would remove top-level declaration\(s\) b/);
    assert.equal(read(dir, 'src/m.ts'), ABC);
    assert.equal(hasBackup(dir), false);
    handleChemxWrite({ ...args, allowRemoved: ['b'] }, dir);
    assert.equal(read(dir, 'src/m.ts'), args.content);
  });
});
