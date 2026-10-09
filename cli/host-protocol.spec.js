import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runPillarsWizard } from './pillars-wizard.js';
import { isGeneratedContent } from './pillars-write-guard.js';
import {
  PROTOCOL_BEGIN,
  PROTOCOL_END,
  PROTOCOL_HOST_FILES,
  buildProtocolBlock,
  buildProtocolHostFiles,
  upsertProtocolBlock
} from './host-protocol.js';

// Each entry is text a host must be told. Removing or rewording any of these must fail this spec.
const PINNED_PHRASES = [
  '--as=@<your session name>',
  'CHEMX_AGENT_ID',
  'chemx status',
  'chemx team inbox @<you>',
  'chemx team task claim <id> --as=@<you>',
  'chemx team lock acquire <file> --as=@<you> --purpose="#<id>"',
  'chemx read <path> --outline',
  'chemx q -g',
  'chemx patch',
  'chemx test <spec files> [-t name]',
  'chemx commit <files> -m',
  'git add -A',
  'git stash',
  'chemx wait --task=<id>',
  'chemx wait --lock-free=<file>',
  'chemx team task handoff <id> @<to> --as=@<you>',
  'chemx team lock release <file> --as=@<you>',
  'chemx team task done <id> --target=<file> --as=@<you>',
  'Friction: <what happened>',
  'nothing blocks you'
];

const AGENTS_TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'AGENTS.md');

const withTmp = async (prefix, fn) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    await fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const writeRel = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

const runQuiet = async (args, cwd) => {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await runPillarsWizard(args, cwd);
  } finally {
    process.stdout.write = originalWrite;
  }
};

const runCaptured = async (args, cwd) => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await runPillarsWizard(args, cwd);
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
};

test('pillars --protocol-only --write: a refused file prints a not-applied header and skips the other rows', async () => {
  await withTmp('chemx-protocol-refuse-out-', async (tmpDir) => {
    writeRel(tmpDir, 'AGENTS.md', '# Hand authored\n');
    writeRel(tmpDir, 'GEMINI.md', '# mine\n');
    const output = await runCaptured(['--protocol-only', '--write'], tmpDir);
    assert.strictEqual(output.includes(' Applied '), false);
    assert.ok(output.includes('Not applied'));
    assert.ok(/skipped\s+AGENTS\.md/.test(output));
    assert.ok(/refused\s+GEMINI\.md/.test(output));
    assert.strictEqual(exists(tmpDir, '.agent'), false);
    assert.strictEqual(readRel(tmpDir, 'AGENTS.md'), '# Hand authored\n');
  });
});

for (const phrase of PINNED_PHRASES) {
  test(`host-protocol: block, GEMINI.md and the Antigravity rule all carry "${phrase}"`, () => {
    const texts = [buildProtocolBlock(), ...Object.values(buildProtocolHostFiles())];
    for (const text of texts) {
      assert.ok(text.includes(phrase));
    }
  });
}

test('host-protocol: host files are generated, named for their host, and free of em dashes', () => {
  const files = buildProtocolHostFiles();
  assert.deepStrictEqual(Object.keys(files), PROTOCOL_HOST_FILES);
  for (const text of [buildProtocolBlock(), ...Object.values(files)]) {
    assert.strictEqual(text.includes(String.fromCharCode(0x2014)), false);
  }
  for (const text of Object.values(files)) {
    assert.ok(isGeneratedContent(text));
  }
});

test('host-protocol: upsert appends once, replaces in place, and keeps text outside the markers', () => {
  const original = '# Rules\nkeep me\n';
  const once = upsertProtocolBlock(original);
  assert.ok(once.startsWith(original));
  assert.strictEqual(upsertProtocolBlock(once), once);
  const edited = once.replace('Identity', 'Tampered') + '\ntrailing text\n';
  const repaired = upsertProtocolBlock(edited);
  assert.strictEqual(repaired.split(PROTOCOL_BEGIN).length, 2);
  assert.strictEqual(repaired.split(PROTOCOL_END).length, 2);
  assert.ok(repaired.includes('Identity'));
  assert.ok(repaired.endsWith('trailing text\n'));
});

test('pillars --protocol-only --write: writes the protocol files and touches no config or shim', async () => {
  await withTmp('chemx-protocol-only-', async (tmpDir) => {
    writeRel(tmpDir, 'AGENTS.md', '# Hand authored\n');
    writeRel(tmpDir, 'CLAUDE.md', '# Hand authored claude\n');
    const result = await runQuiet(['--protocol-only', '--write'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.ok(readRel(tmpDir, 'AGENTS.md').startsWith('# Hand authored\n'));
    assert.ok(readRel(tmpDir, 'AGENTS.md').includes(PROTOCOL_BEGIN));
    assert.ok(readRel(tmpDir, 'GEMINI.md').includes('chemx commit'));
    assert.ok(readRel(tmpDir, '.agent/rules/chemx-protocol.md').includes('chemx wait'));
    assert.ok(readRel(tmpDir, '.cursorrules').includes(PROTOCOL_BEGIN));
    assert.strictEqual(readRel(tmpDir, 'CLAUDE.md'), '# Hand authored claude\n');
    assert.strictEqual(exists(tmpDir, '.chemx/config.json'), false);
    assert.strictEqual(exists(tmpDir, 'llms.txt'), false);
  });
});

test('pillars --protocol-only: a second --write changes nothing', async () => {
  await withTmp('chemx-protocol-idem-', async (tmpDir) => {
    writeRel(tmpDir, 'AGENTS.md', '# Hand authored\n');
    await runQuiet(['--protocol-only', '--write'], tmpDir);
    const second = await runQuiet(['--protocol-only', '--write'], tmpDir);
    assert.deepStrictEqual(second.filesWritten, []);
    assert.ok(second.planned.every((p) => p.action === 'unchanged'));
  });
});

test('pillars --protocol-only: a hand-written GEMINI.md is refused and nothing is written', async () => {
  await withTmp('chemx-protocol-refuse-', async (tmpDir) => {
    writeRel(tmpDir, 'AGENTS.md', '# Hand authored\n');
    writeRel(tmpDir, 'GEMINI.md', '# mine\n');
    const result = await runQuiet(['--protocol-only', '--write'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.refused, ['GEMINI.md']);
    assert.deepStrictEqual(result.filesWritten, []);
    assert.strictEqual(readRel(tmpDir, 'AGENTS.md'), '# Hand authored\n');
  });
});

test('pillars --protocol: adds the protocol to the shim run, with one AGENTS.md and one cursor block', async () => {
  await withTmp('chemx-protocol-add-', async (tmpDir) => {
    const result = await runQuiet(['--preset=minimal', '--protocol', '-y', '--write'], tmpDir);
    assert.strictEqual(result.success, true);
    const files = result.planned.map((p) => p.file);
    assert.strictEqual(files.filter((f) => f === 'AGENTS.md').length, 1);
    assert.strictEqual(files.filter((f) => f === '.cursorrules').length, 1);
    assert.ok(exists(tmpDir, '.chemx/config.json'));
    assert.ok(exists(tmpDir, 'CLAUDE.md'));
    assert.ok(readRel(tmpDir, 'AGENTS.md').includes(PROTOCOL_BEGIN));
    assert.ok(isGeneratedContent(readRel(tmpDir, '.cursorrules')));
    assert.ok(readRel(tmpDir, '.cursorrules').includes('chemx team lock acquire'));
  });
});

test('pillars without --protocol: writes no protocol file', async () => {
  await withTmp('chemx-protocol-off-', async (tmpDir) => {
    await runQuiet(['--preset=minimal', '-y', '--write'], tmpDir);
    assert.strictEqual(exists(tmpDir, 'GEMINI.md'), false);
    assert.strictEqual(exists(tmpDir, '.agent/rules/chemx-protocol.md'), false);
    // The seeded AGENTS.md is a copy of the kit's own, which carries the block; the run adds none of its own.
    assert.strictEqual(readRel(tmpDir, 'AGENTS.md'), fs.readFileSync(AGENTS_TEMPLATE, 'utf8'));
  });
});
