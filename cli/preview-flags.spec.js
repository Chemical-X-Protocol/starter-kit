import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPatcherCli, runWriterCli } from './patcher.js';
import { runExplodeCli } from './exploder.js';
import { runMutatorCli } from './mutators.js';
import { isPreviewFlag, findUnknownFlags } from './cli-args.js';
import { handleChemx, parseCommand } from './mcp/tools.js';

const PREVIEW_SPELLINGS = ['--dry-run', '-n', '--dry-run=true', '--dry-run=false', '--dryRun', '--dry_run', '--dryrun', '-dry-run'];

const inProject = async (files, fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-preview-flags-')));
  const cwd = process.cwd();
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    process.chdir(dir);
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    return await fn(dir);
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((rel) => {
  const abs = path.join(dir, rel);
  const isFile = fs.statSync(abs).isFile();
  return isFile ? `${rel}:${fs.readFileSync(abs, 'utf-8')}` : rel;
});

test('isPreviewFlag: every dry-run spelling, with or without a value, is a preview', () => {
  for (const flag of PREVIEW_SPELLINGS) assert.equal(isPreviewFlag(flag), true, flag);
  for (const flag of ['--dry', '--run', 'dry-run', '--json', '-x']) assert.equal(isPreviewFlag(flag), false, flag);
  assert.deepEqual(findUnknownFlags(['a.ts', '--json', '--dryRun', '--as=x', '--frobnicate=1', '-q'], ['--as']), ['--frobnicate=1', '-q']);
});

test('CLI patch, write, explode and fix never write under any preview spelling', async () => {
  const files = {
    'src/d.ts': 'export const a = 1\n',
    'src/boom.ts': 'export const boom = 1;\n',
    'src/dash.ts': 'export const s = 1; // hope this helps\n'
  };
  await inProject(files, async (dir) => {
    const before = snapshot(dir);
    for (const flag of PREVIEW_SPELLINGS) {
      const patched = runPatcherCli(['src/d.ts', '--target=a = 1', '--replacement=a = 2', flag], false);
      assert.equal(patched?.dryRun, true, `patch ${flag}`);
      const written = runWriterCli(['src/zz.ts', '--content=export const x = 1\n', flag], false);
      assert.equal(written?.dryRun, true, `write ${flag}`);
      const exploded = await runExplodeCli(['src/boom.ts', flag, '--json'], false);
      assert.equal(exploded.dryRun, true, `explode ${flag}`);
      const fixed = await runMutatorCli(['fix', 'src/dash.ts', flag], false);
      assert.equal(fixed.dryRun, true, `fix ${flag}`);
      assert.deepEqual(snapshot(dir), before, flag);
    }
  });
});

test('CLI mutating commands refuse unknown flags instead of guessing', async () => {
  await inProject({ 'src/d.ts': 'export const a = 1\n', 'src/boom.ts': 'export const boom = 1;\n' }, async (dir) => {
    const before = snapshot(dir);
    assert.equal(runPatcherCli(['src/d.ts', '--target=a = 1', '--replacement=a = 2', '--preview'], false), null);
    assert.equal(runWriterCli(['src/zz.ts', '--content=x', '--force'], false), null);
    await assert.rejects(runExplodeCli(['src/boom.ts', '--preview'], false), /Unknown flag/);
    await assert.rejects(runMutatorCli(['fix', 'src/d.ts', '--preview'], false), /Unknown flag/);
    assert.deepEqual(snapshot(dir), before);
  });
});

test('MCP command string: every preview spelling previews, matching the CLI', async () => {
  for (const flag of PREVIEW_SPELLINGS) {
    assert.equal(parseCommand(`patch a.ts ${flag}`, { dryRun: false }).params.dryRun, true, flag);
  }
  await inProject({ 'src/a.ts': 'export const a = 1\n' }, async (dir) => {
    const res = await handleChemx({ command: 'patch src/a.ts --dry-run=true', projectRoot: dir, params: { search: 'a = 1', replace: 'a = 4' } });
    assert.equal(res.dryRun, true);
    assert.equal(fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf-8'), 'export const a = 1\n');
  });
});
