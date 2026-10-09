import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { patchFile, writeFile } from './patcher.js';
import { handleChemxPatch } from './mcp/tools-patch.js';
import { parseCommand } from './mcp/tools.js';

const makeProject = (files) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-patch-safety-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
};
const writeFileOver = (dir) => writeFile('src/p.ts', { content: 'export const z = 1;\n', overwrite: true, cwd: dir, skipIndex: true });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('patch: replacement is literal, `$` patterns are not expanded', () => {
  const dir = makeProject({ 'src/price.ts': 'export const x = 1\n' });
  try {
    const replacement = 'export const x = 1\nexport const usd = (n: number) => `$${n}`\nconst re = /^$&/\nconst q = "$\'$`"';
    patchFile('src/price.ts', { targetContent: 'export const x = 1', replacementContent: replacement, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/price.ts'), `${replacement}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: empty or whitespace target is refused and the file is untouched', () => {
  const dir = makeProject({ 'src/e.ts': 'abc\n' });
  try {
    for (const target of ['', '   ', '\n']) {
      assert.throws(
        () => patchFile('src/e.ts', { targetContent: target, replacementContent: 'X', allowMultiple: true, cwd: dir, skipIndex: true }),
        /empty or whitespace-only/
      );
    }
    assert.equal(read(dir, 'src/e.ts'), 'abc\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: ambiguity error names the matching lines; allowMultiple reports a numeric count', () => {
  const dir = makeProject({ 'src/m.ts': 'export const a = 1;\nconst t = 0;\nexport const b = 1;\nconst u = 0;\n' });
  try {
    assert.throws(
      () => patchFile('src/m.ts', { targetContent: ' = 0;', replacementContent: ' = 9;', cwd: dir, skipIndex: true }),
      /found multiple times .*2 matches at lines 2, 4/
    );
    const res = patchFile('src/m.ts', { targetContent: ' = 0;', replacementContent: ' = 9;', allowMultiple: true, cwd: dir, skipIndex: true });
    assert.equal(res.replaced, 2);
    assert.deepEqual(res.matchLines, [2, 4]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: LF target on a CRLF file is normalized instead of failing with a misleading hint', () => {
  const dir = makeProject({ 'src/c.ts': 'const a = 1;\r\nconst b = 2;\r\n' });
  try {
    const res = patchFile('src/c.ts', { targetContent: 'const a = 1;\nconst b = 2;', replacementContent: 'const a = 1;\nconst b = 3;', cwd: dir, skipIndex: true });
    assert.equal(res.eol, 'crlf-normalized');
    assert.equal(read(dir, 'src/c.ts'), 'const a = 1;\r\nconst b = 3;\r\n');
    assert.throws(
      () => patchFile('src/c.ts', { targetContent: 'nope\nmissing', replacementContent: 'x', cwd: dir, skipIndex: true }),
      /uses CRLF line endings/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: dry run returns an uncapped unified diff and audits the patched text', () => {
  const body = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  const dir = makeProject({ 'src/d.ts': `${body}\n` });
  try {
    const res = patchFile('src/d.ts', { targetContent: 'export const v0 = 0;', replacementContent: 'export const v0 = 100;', dryRun: true, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/d.ts'), `${body}\n`);
    assert.equal(res.dryRun, true);
    assert.match(res.diff, /^--- a\/src\/d\.ts\n\+\+\+ b\/src\/d\.ts\n@@ -1,4 \+1,4 @@\n-export const v0 = 0;\n\+export const v0 = 100;/);
    assert.deepEqual(res.changedLines, { start: 1, end: 1 });

    const audited = patchFile('src/d.ts', { targetContent: 'export const v1 = 1;', replacementContent: 'export const v1 = 1; // a \u2014 b', dryRun: true, cwd: dir, skipIndex: true });
    assert.ok(audited.violations.some((v) => v.rule === 'TYPOGRAPHY_EM_DASH'), 'dry-run audit must see the patched text');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: refuses a result that does not parse, and a silent top-level declaration removal', () => {
  const dir = makeProject({ 'src/p.ts': 'export const a = 1;\nexport function keep() { return a; }\n' });
  try {
    assert.throws(
      () => patchFile('src/p.ts', { targetContent: 'export const a = 1;', replacementContent: 'export const a = (1;', cwd: dir, skipIndex: true }),
      /does not parse/
    );
    assert.throws(
      () => patchFile('src/p.ts', { targetContent: 'export function keep() { return a; }\n', replacementContent: '', cwd: dir, skipIndex: true }),
      /would remove top-level declaration\(s\) keep/
    );
    assert.throws(
      () => patchFile('src/p.ts', { targetContent: 'export const a = 1;', replacementContent: 'export const b = 1;', dryRun: true, cwd: dir, skipIndex: true }),
      /would remove top-level declaration\(s\) a \(and would add b\)/,
      'removing A while adding an unrelated B is refused unless A is named'
    );
    const renamed = patchFile('src/p.ts', { targetContent: 'export const a = 1;', replacementContent: 'export const b = 1;', allowRemoved: ['a'], dryRun: true, cwd: dir, skipIndex: true });
    assert.deepEqual(renamed.declarations, { removed: ['a'], added: ['b'] }, 'a named rename is allowed and reported');
    assert.throws(
      () => writeFileOver(dir),
      /would remove top-level declaration\(s\) a, keep/
    );
    assert.equal(read(dir, 'src/p.ts'), 'export const a = 1;\nexport function keep() { return a; }\n');
    const res = patchFile('src/p.ts', { targetContent: 'export function keep() { return a; }\n', replacementContent: '', allowRemoved: ['keep'], cwd: dir, skipIndex: true });
    assert.equal(res.status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: write is atomic with a backup, and a foreign team lock blocks it', async () => {
  const dir = makeProject({ 'src/l.ts': 'export const a = 1;\n' });
  try {
    const res = patchFile('src/l.ts', { targetContent: 'a = 1', replacementContent: 'a = 2', cwd: dir, skipIndex: true });
    assert.equal(fs.readFileSync(path.join(dir, res.backup), 'utf-8'), 'export const a = 1;\n');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'src')), ['l.ts']);

    const { openIndexDb } = await import('./search-schema.js');
    const { requestFileLock } = await import('./team/team-db-locks.js');
    const db = openIndexDb(dir, { fresh: true });
    assert.equal(requestFileLock(db, 'src/l.ts', '@other', { cwd: dir }).granted, true);
    assert.throws(
      () => patchFile('src/l.ts', { targetContent: 'a = 2', replacementContent: 'a = 3', cwd: dir, skipIndex: true }),
      /locked by @other/
    );
    const own = patchFile('src/l.ts', { targetContent: 'a = 2', replacementContent: 'a = 3', agentId: 'other', cwd: dir, skipIndex: true });
    assert.equal(own.status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP patch: dryRun:true (and command-string --dry-run) never writes', () => {
  const dir = makeProject({ 'src/x.ts': 'export const a = 1\n' });
  try {
    const res = handleChemxPatch({ path: 'src/x.ts', search: 'a = 1', replace: 'a = 2', dryRun: true }, dir);
    assert.equal(res.dryRun, true);
    assert.match(res.diff, /\+export const a = 2/);
    assert.equal(read(dir, 'src/x.ts'), 'export const a = 1\n');

    const parsed = parseCommand('patch src/x.ts --dry-run', { search: 'a = 1', replace: 'a = 3' });
    const res2 = handleChemxPatch(parsed.params, dir);
    assert.equal(res2.dryRun, true);
    assert.equal(read(dir, 'src/x.ts'), 'export const a = 1\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI patch: text output names removed and added declarations', async () => {
  const { runPatcherCli } = await import('./patcher-cli.js');
  const dir = makeProject({ 'src/r.ts': 'export const a = 1;\n' });
  const cwd = process.cwd();
  const write = process.stdout.write;
  let printed = '';
  try {
    process.chdir(dir);
    process.stdout.write = (chunk) => { printed += chunk; return true; };
    runPatcherCli(['src/r.ts', '--target=export const a = 1;', '--replacement=export const b = 1;', '--allow-remove=a', '--dry-run'], false);
  } finally {
    process.stdout.write = write;
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(printed, /Declarations: removed \[a\], added \[b\]/);
});

test('patch from a subdirectory still honors a lease taken at the project root', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { initTeamSchema } = await import('./team/team-schema.js');
  const dir = makeProject({ 'src/l.ts': 'export const l = 1;\n' });
  try {
    fs.mkdirSync(path.join(dir, '.chemx'));
    const db = new DatabaseSync(path.join(dir, '.chemx', 'index.db'));
    initTeamSchema(db);
    db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)').run('src/l.ts', '@alice', Date.now(), Date.now() + 60000, 'refactor');
    db.close();
    assert.throws(
      () => patchFile('l.ts', { targetContent: 'l = 1', replacementContent: 'l = 2', cwd: path.join(dir, 'src'), skipIndex: true }),
      (err) => /locked by @alice/.test(err.message) && !/holder's agent id/.test(err.message)
    );
    assert.equal(read(dir, 'src/l.ts'), 'export const l = 1;\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const SFC = `<template>
  <div class="counter">{{ count }} // not a comment</div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0) // hope this helps
</script>

<style scoped>
.counter { background: url(//cdn.example.com/a.png); }
</style>
`;

const MD = '# Title\n\n```js\n// hope this helps\nconst a = 1\n```\n\nSee //cdn.example.com and $& and $1.\n';

test('patch: a Vue SFC keeps template and style byte-for-byte; a broken script is refused', () => {
  const dir = makeProject({ 'src/c.vue': SFC });
  try {
    patchFile('src/c.vue', { targetContent: 'ref(0)', replacementContent: 'ref(1)', cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/c.vue'), SFC.replace('ref(0)', 'ref(1)'));
    patchFile('src/c.vue', { targetContent: '{{ count }}', replacementContent: '{{ count * 2 }}', cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/c.vue'), SFC.replace('ref(0)', 'ref(1)').replace('{{ count }}', '{{ count * 2 }}'));
    const before = read(dir, 'src/c.vue');
    assert.throws(() => patchFile('src/c.vue', { targetContent: 'ref(1)', replacementContent: 'ref(1', cwd: dir, skipIndex: true }), /does not parse/);
    assert.equal(read(dir, 'src/c.vue'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch and write: Markdown is replaced literally and nothing else changes', () => {
  const dir = makeProject({ 'docs/a.md': MD });
  try {
    patchFile('docs/a.md', { targetContent: '# Title', replacementContent: '# Title $&', cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'docs/a.md'), MD.replace('# Title', () => '# Title $&'));
    assert.throws(() => writeFile('docs/a.md', { content: 'x', cwd: dir, skipIndex: true }), /overwrite/);
    writeFile('docs/b.md', { content: MD, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'docs/b.md'), MD);
    writeFile('src/w.vue', { content: SFC, cwd: dir, skipIndex: true });
    assert.equal(read(dir, 'src/w.vue'), SFC);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const GENERIC_SFC = `<script setup lang="ts" generic="T extends Record<string, number>">
const props = defineProps<{ items: T[] }>()
function keep() { return props }
</script>

<template><div>{{ keep() }}</div></template>
`;

test('patch: a Vue generic SFC is still parsed, so declaration removal and broken results refuse', () => {
  const dir = makeProject({ 'src/g.vue': GENERIC_SFC });
  try {
    assert.throws(() => patchFile('src/g.vue', { targetContent: 'function keep() { return props }', replacementContent: '', cwd: dir, skipIndex: true }), /keep/);
    assert.throws(() => patchFile('src/g.vue', { targetContent: 'defineProps<{ items: T[] }>()', replacementContent: 'defineProps<{ items: T[] }>(', cwd: dir, skipIndex: true }), /does not parse/);
    assert.equal(read(dir, 'src/g.vue'), GENERIC_SFC);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: an already-broken file reports that the parse checks could not run (lib, MCP)', () => {
  const dir = makeProject({ 'src/b.ts': 'export const a = (\nexport const b = 1\n' });
  try {
    const res = patchFile('src/b.ts', { targetContent: 'b = 1', replacementContent: 'b = 2', cwd: dir, skipIndex: true, dryRun: true });
    assert.equal(res.parse.ok, false);
    assert.match(res.parse.note, /could not run/);
    const mcp = handleChemxPatch({ path: 'src/b.ts', search: 'b = 1', replace: 'b = 2', dryRun: true }, dir);
    assert.ok(mcp.warnings.some((w) => /\[Parse\]/.test(w)), JSON.stringify(mcp.warnings));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patch: the line budget counts lines the same way newLines does', async () => {
  const { evaluateGuardrails } = await import('./edit-guardrails.js');
  const exactly500 = 'export const a = 1;\n'.repeat(500);
  assert.equal(evaluateGuardrails({ absPath: '/x/a.ts', relPath: 'a.ts', content: exactly500, skipCheck: true }).lineBudget.passed, true);
  const dir = makeProject({ 'src/price.ts': 'export const x = 1\nexport const y = 2\n' });
  try {
    const res = patchFile('src/price.ts', { targetContent: 'x = 1', replacementContent: 'x = 1\nexport const z = 3', cwd: dir, skipIndex: true, dryRun: true });
    assert.equal(res.lineBudget.lines, res.newLines);
    assert.equal(res.newLines, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
