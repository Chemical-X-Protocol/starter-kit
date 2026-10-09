import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleChemx, parseCommand } from './tools.js';

const withProject = async (files, fn) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dry-parity-')));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"dry-parity","type":"module"}\n');
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const payloadOf = (res) => {
  const text = res?.content?.[0]?.text;
  return typeof text === 'string' ? text : JSON.stringify(res);
};

test('MCP command-string `write <file> --dry-run` previews and never writes', async () => {
  await withProject({}, async (dir) => {
    const res = await handleChemx({ command: 'write src/new.ts --dry-run', projectRoot: dir, params: { path: 'src/new.ts', content: 'export const z = 1\n' } });
    assert.match(payloadOf(res), /"dryRun":\s*true/);
    assert.equal(fs.existsSync(path.join(dir, 'src/new.ts')), false);
  });
});

test('parseCommand: a command-string preview flag wins over params for every mutating action', () => {
  for (const command of ['write a.ts --dry-run', 'patch a.ts -n', 'autofix src --dry-run', 'explode a.tsx --dry-run']) {
    assert.equal(parseCommand(command, { dryRun: false }).params.dryRun, true, command);
  }
  assert.equal(parseCommand('write a.ts', { content: 'x' }).params.path, 'a.ts');
  assert.equal(parseCommand('write a.ts --overwrite', { content: 'x' }).params.overwrite, true);
});

test('MCP autofix honors the dry-run spellings patch and write accept', async () => {
  const source = 'export const a = 1 // hope this helps\n';
  await withProject({ 'src/af.ts': source }, async (dir) => {
    for (const flag of ['dry_run', 'dry-run', 'n']) {
      await handleChemx({ action: 'autofix', params: { path: 'src/af.ts', projectRoot: dir, [flag]: true } });
      assert.equal(fs.readFileSync(path.join(dir, 'src/af.ts'), 'utf-8'), source, flag);
    }
  });
});
