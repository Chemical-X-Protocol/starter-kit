import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PILLARS, PILLAR_PRESETS } from './pillars-schema.js';
import { runPillarsWizard } from './pillars-wizard.js';
import { GENERATED_MARKERS, isGeneratedContent } from './pillars-write-guard.js';

test('pillars-schema: contains all 7 canonical architectural pillars', () => {
  assert.strictEqual(PILLARS.length, 7);
  const ids = PILLARS.map((p) => p.id);
  assert.ok(ids.includes('p1_line_budgets'));
  assert.ok(ids.includes('p2_zero_raw_dom'));
  assert.ok(ids.includes('p3_toc_views'));
  assert.ok(ids.includes('p4_composables'));
  assert.ok(ids.includes('p5_verification_first'));
  assert.ok(ids.includes('p6_ast_query_machine'));
  assert.ok(ids.includes('p7_swarm_backlog'));

  for (const p of PILLARS) {
    assert.ok(p.id, 'Pillar must have an id');
    assert.ok(p.title, 'Pillar must have a title');
    assert.ok(p.summary, 'Pillar must have a summary');
  }
});

test('pillars-schema: presets exist and map to pillar IDs', () => {
  const presetKeys = Object.keys(PILLAR_PRESETS);
  assert.ok(presetKeys.includes('recommended'));
  assert.ok(presetKeys.includes('strict'));
  assert.ok(presetKeys.includes('minimal'));
  assert.ok(presetKeys.includes('none'));

  assert.strictEqual(PILLAR_PRESETS.strict.pillars.length, 7);
  assert.strictEqual(PILLAR_PRESETS.none.pillars.length, 0);
  assert.ok(PILLAR_PRESETS.minimal.pillars.length > 0);
  assert.ok(PILLAR_PRESETS.recommended.pillars.length >= 4);
});

const withTmp = async (prefix, fn) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    await fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const HAND_AUTHORED = '# Hand authored\n';
const TEMPLATE_AGENTS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'AGENTS.md'), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const planFor = (result, name) => result.planned.find((p) => path.basename(p.file) === name);

test('pillars-wizard: dry run plans files without writing any', async () => {
  await withTmp('chemx-pillars-dry-', async (tmpDir) => {
    const result = await runPillarsWizard(['--preset=minimal', '--dry-run'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.preset, 'minimal');
    assert.deepStrictEqual(result.filesWritten, []);
    for (const rel of ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'llms.txt', '.chemx/config.json']) {
      assert.strictEqual(exists(tmpDir, rel), false, rel);
    }
  });
});

test('pillars-wizard: writes config, host shims, and seeds AGENTS.md from the template', async () => {
  await withTmp('chemx-pillars-run-', async (tmpDir) => {
    const result = await runPillarsWizard(['--preset=recommended', '-y', '--write'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, false);

    const config = JSON.parse(readRel(tmpDir, '.chemx/config.json'));
    assert.strictEqual(config.pillars?.lineBudgets, true);
    assert.strictEqual(config.pillars?.verificationFirst, false);

    assert.strictEqual(readRel(tmpDir, 'AGENTS.md'), TEMPLATE_AGENTS);
    assert.ok(readRel(tmpDir, 'CLAUDE.md').startsWith(GENERATED_MARKERS.md));
    assert.ok(readRel(tmpDir, '.cursorrules').startsWith(GENERATED_MARKERS.rules));
    assert.ok(isGeneratedContent(readRel(tmpDir, 'llms.txt')));
  });
});

test('pillars-wizard: none preset writes config only', async () => {
  await withTmp('chemx-pillars-none-', async (tmpDir) => {
    const result = await runPillarsWizard(['--preset=none', '-y', '--write'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.selectedPillarIds.length, 0);
    assert.ok(exists(tmpDir, '.chemx/config.json'));
    for (const rel of ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'llms.txt']) {
      assert.strictEqual(exists(tmpDir, rel), false, `Preset none should not create ${rel}`);
    }
  });
});

test('pillars-wizard: writes nothing without --write', async () => {
  await withTmp('chemx-pillars-nowrite-', async (tmpDir) => {
    const result = await runPillarsWizard(['--preset=recommended'], tmpDir);
    assert.deepStrictEqual(result.filesWritten, []);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(exists(tmpDir, 'AGENTS.md'), false);
    assert.strictEqual(exists(tmpDir, 'CLAUDE.md'), false);
    assert.strictEqual(exists(tmpDir, '.chemx/config.json'), false);
    assert.strictEqual(planFor(result, 'AGENTS.md').action, 'create');
    assert.strictEqual(planFor(result, 'CLAUDE.md').action, 'create');
  });
});

test('pillars-wizard: --json never implies write', async () => {
  await withTmp('chemx-pillars-json-', async (tmpDir) => {
    await runPillarsWizard(['--preset=recommended', '-y', '--json'], tmpDir);
    assert.strictEqual(exists(tmpDir, 'AGENTS.md'), false);
    assert.strictEqual(exists(tmpDir, 'CLAUDE.md'), false);
    assert.strictEqual(exists(tmpDir, '.chemx/config.json'), false);
  });
});

test('pillars-wizard: never modifies an existing AGENTS.md, even with --force', async () => {
  await withTmp('chemx-pillars-agents-', async (tmpDir) => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), HAND_AUTHORED);
    const result = await runPillarsWizard(['--preset=strict', '-y', '--write', '--force'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(readRel(tmpDir, 'AGENTS.md'), HAND_AUTHORED);
    assert.strictEqual(planFor(result, 'AGENTS.md'), undefined);
    assert.strictEqual(exists(tmpDir, 'AGENTS.md.chemx-backup'), false);
  });
});

test('pillars-wizard: refuses to overwrite a hand-authored CLAUDE.md', async () => {
  await withTmp('chemx-pillars-refuse-', async (tmpDir) => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), HAND_AUTHORED);
    const result = await runPillarsWizard(['--preset=recommended', '-y', '--write'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.refused, ['CLAUDE.md']);
    assert.strictEqual(readRel(tmpDir, 'CLAUDE.md'), HAND_AUTHORED);
    assert.strictEqual(exists(tmpDir, '.cursorrules'), false);
    assert.strictEqual(exists(tmpDir, '.chemx/config.json'), false);
    assert.strictEqual(exists(tmpDir, 'CLAUDE.md.chemx-backup'), false);
  });
});

test('pillars-wizard: --force overwrites a hand-authored shim and keeps a backup', async () => {
  await withTmp('chemx-pillars-force-', async (tmpDir) => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), HAND_AUTHORED);
    const result = await runPillarsWizard(['--preset=recommended', '-y', '--write', '--force'], tmpDir);
    assert.ok(readRel(tmpDir, 'CLAUDE.md').startsWith(GENERATED_MARKERS.md));
    assert.strictEqual(readRel(tmpDir, 'CLAUDE.md.chemx-backup'), HAND_AUTHORED);
    assert.ok(planFor(result, 'CLAUDE.md').backupPath.endsWith('CLAUDE.md.chemx-backup'));
  });
});

test('pillars-wizard: regenerating backs up changed shims and skips identical ones', async () => {
  await withTmp('chemx-pillars-regen-', async (tmpDir) => {
    await runPillarsWizard(['--preset=minimal', '-y', '--write'], tmpDir);
    const minimalContent = readRel(tmpDir, 'CLAUDE.md');
    await runPillarsWizard(['--preset=strict', '-y', '--write'], tmpDir);
    assert.strictEqual(readRel(tmpDir, 'CLAUDE.md.chemx-backup'), minimalContent);
    const again = await runPillarsWizard(['--preset=strict', '-y', '--write'], tmpDir);
    assert.strictEqual(planFor(again, 'CLAUDE.md').action, 'unchanged');
  });
});

test('pillars-write-guard: isGeneratedContent recognizes legacy generated headers', () => {
  const legacy = '> NOTE: This file is a project configuration generated from your selected Chemical X pillars.';
  assert.strictEqual(isGeneratedContent(legacy), true);
  assert.strictEqual(isGeneratedContent(HAND_AUTHORED), false);
});

test('pillars-wizard: an existing backup is never overwritten', async () => {
  await withTmp('chemx-pillars-backup-', async (tmpDir) => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), HAND_AUTHORED);
    await runPillarsWizard(['--preset=recommended', '-y', '--write', '--force'], tmpDir);
    await runPillarsWizard(['--preset=strict', '-y', '--write'], tmpDir);
    assert.strictEqual(readRel(tmpDir, 'CLAUDE.md.chemx-backup'), HAND_AUTHORED);
    assert.ok(exists(tmpDir, 'CLAUDE.md.chemx-backup.2'));
  });
});
