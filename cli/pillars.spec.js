import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  PILLARS,
  PILLAR_PRESETS,
  buildCustomAgentsMd,
  buildCustomCursorRules
} from './pillars-schema.js';
import { runPillarsWizard } from './pillars-wizard.js';

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
    assert.ok(p.agentsDirective, 'Pillar must have an agentsDirective');
    assert.ok(p.cursorRule, 'Pillar must have cursorRule string');
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

test('pillars-schema: buildCustomAgentsMd includes review notice and selected sections', () => {
  const md = buildCustomAgentsMd(['p1_line_budgets', 'p4_composables']);
  assert.ok(md.includes('NOTE: This file is a project configuration generated from your selected Chemical X pillars'));
  assert.ok(md.includes('Molecular Line Budgets'));
  assert.ok(md.includes('Composable'));
  assert.strictEqual(md.includes('Raw DOM'), false);
  assert.strictEqual(md.includes('Swarm Task Backlog'), false);
  assert.strictEqual(md.includes('\u2014'), false, 'Agents md must not contain em dashes');
});

test('pillars-schema: buildCustomAgentsMd handles empty selection cleanly', () => {
  const md = buildCustomAgentsMd([]);
  assert.ok(md.includes('NOTE: This file is a project configuration'));
  assert.ok(md.includes('No architectural pillars currently configured'));
  assert.strictEqual(md.includes('\u2014'), false, 'Agents md must not contain em dashes');
});

test('pillars-schema: buildCustomCursorRules formats selected rules with header notice', () => {
  const rules = buildCustomCursorRules(['p1_line_budgets', 'p2_zero_raw_dom']);
  assert.ok(rules.includes('Generated from selected project pillars'));
  assert.ok(rules.includes('100 LOC'));
  assert.ok(rules.includes('Zero-Raw-DOM'));
  assert.strictEqual(rules.includes('Silent verification'), false);
  assert.strictEqual(rules.includes('\u2014'), false, 'Cursor rules must not contain em dashes');
});

test('pillars-wizard: dry run produces planned output without writing files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-pillars-dry-'));
  try {
    const result = await runPillarsWizard(['--preset=minimal', '--dry-run'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.preset, 'minimal');
    assert.strictEqual(result.filesWritten.length, 0);

    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'AGENTS.md')), false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.cursorrules')), false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.chemx', 'config.json')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pillars-wizard: writes config and agent files when invoked non-interactively', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-pillars-run-'));
  try {
    const result = await runPillarsWizard(['--preset=recommended', '-y'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.preset, 'recommended');
    assert.ok(result.filesWritten.length >= 3);

    const configPath = path.join(tmpDir, '.chemx', 'config.json');
    assert.ok(fs.existsSync(configPath));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(config.pillars?.lineBudgets, true);
    assert.strictEqual(config.pillars?.verificationFirst, false);

    const agentsMdPath = path.join(tmpDir, 'AGENTS.md');
    assert.ok(fs.existsSync(agentsMdPath));
    const agentsContent = fs.readFileSync(agentsMdPath, 'utf8');
    assert.ok(agentsContent.includes('NOTE: This file is a project configuration'));
    assert.strictEqual(agentsContent.includes('\u2014'), false);

    const cursorPath = path.join(tmpDir, '.cursorrules');
    assert.ok(fs.existsSync(cursorPath));
    const cursorContent = fs.readFileSync(cursorPath, 'utf8');
    assert.ok(cursorContent.includes('Generated from selected project pillars'));
    assert.strictEqual(cursorContent.includes('\u2014'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pillars-wizard: none preset writes minimal config and skips agent files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-pillars-none-'));
  try {
    const result = await runPillarsWizard(['--preset=none', '-y'], tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.selectedPillarIds.length, 0);

    const configPath = path.join(tmpDir, '.chemx', 'config.json');
    assert.ok(fs.existsSync(configPath));

    const agentsMdPath = path.join(tmpDir, 'AGENTS.md');
    assert.strictEqual(fs.existsSync(agentsMdPath), false, 'Preset none should not create AGENTS.md');
    const cursorPath = path.join(tmpDir, '.cursorrules');
    assert.strictEqual(fs.existsSync(cursorPath), false, 'Preset none should not create .cursorrules');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
