// Forge inside the audit traverse (P2 part B): the units an audit collects through
// createFingerprintVisitors equal the standalone collectFileUnits units for the same file, for plain
// JS, TS, a Vue SFC (script overlay plus template AST) and TSX. Inputs are live repo files read at
// test time, so the equivalence is checked on real code as it stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCode } from '../audit/rules.js';
import { collectFileUnits } from './file-units.js';
import { createFileFingerprint } from './fingerprint-visitors.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// [file read from the repo, path it is audited under]. The TSX blueprint sits in an excluded
// directory, so it is audited under a neutral path; both sides see the same path.
const CASES = [
  ['cli/team/team-flags.js', 'cli/team/team-flags.js'],
  ['cli/forge/anchors.js', 'cli/forge/anchors.js'],
  ['src/ui/composables/useSelfCleaningTimeout.ts', 'src/ui/composables/useSelfCleaningTimeout.ts'],
  ['app/components/molecules/funnel/FunnelSystemLayersSection.vue', 'app/components/molecules/funnel/FunnelSystemLayersSection.vue'],
  ['blueprints/view-template.tsx', 'app/view-template.tsx']
];

const keyOf = (unit) => [unit.kind, unit.start, unit.end, unit.startOffset, unit.blockId, unit.ordinal, unit.fp1, unit.fp2, unit.fp3, unit.mass].join('|');

const auditUnitsOf = (sourcePath, relativePath) => {
  const content = fs.readFileSync(path.join(KIT_ROOT, sourcePath), 'utf-8');
  const fingerprint = createFileFingerprint(relativePath);
  auditCode(content, path.join(KIT_ROOT, relativePath), relativePath, { fingerprint });
  return { content, result: fingerprint.result() };
};

for (const [sourcePath, relativePath] of CASES) {
  test(`audit-traverse units equal collectFileUnits for ${sourcePath}`, () => {
    const { content, result } = auditUnitsOf(sourcePath, relativePath);
    const standalone = collectFileUnits(relativePath, content);
    assert.equal(result.error, null);
    assert.ok(result.units.length > 0, 'the file yields units');
    assert.deepEqual(result.units.map(keyOf), standalone.units.map(keyOf));
  });
}

// Two SFC shapes where the audit and the standalone path used to store different rows: a classic
// <script> that redeclares an import of <script setup> (the overlay fails, per-block fallback), and a
// script with a syntax error (template units must not depend on the script parse).
const SFC_PATH = CASES[3][1];
const SFC_SOURCE = () => fs.readFileSync(path.join(KIT_ROOT, CASES[3][0]), 'utf-8');
const CLASSIC_BLOCK = "<script lang=\"ts\">\nimport { ref, computed } from 'vue';\nexport default { name: 'FunnelSystemLayersSection' };\n</script>\n";

const auditContentUnits = (content) => {
  const fingerprint = createFileFingerprint(SFC_PATH);
  auditCode(content, path.join(KIT_ROOT, SFC_PATH), SFC_PATH, { fingerprint });
  return fingerprint.result();
};

test('an SFC whose script blocks redeclare an import stores the same rows on both paths', () => {
  const content = `${CLASSIC_BLOCK}${SFC_SOURCE()}`;
  const audited = auditContentUnits(content);
  const standalone = collectFileUnits(SFC_PATH, content);
  assert.equal(standalone.error, null, 'the per-block fallback parses');
  assert.ok(standalone.units.some((unit) => unit.kind !== 'tmpl'), 'script units from the fallback blocks');
  assert.deepEqual(standalone.units.map(keyOf), audited.units.map(keyOf));
});

test('an SFC whose script does not parse still stores its template units on both paths', () => {
  const content = SFC_SOURCE().replace("const selectedLayerId = ref<string>('architecture');", 'const selectedLayerId = ;');
  const audited = auditContentUnits(content);
  const standalone = collectFileUnits(SFC_PATH, content);
  assert.ok(standalone.error, 'the parse failure is still reported');
  assert.ok(standalone.units.length > 0 && standalone.units.every((unit) => unit.kind === 'tmpl'));
  assert.deepEqual(standalone.units.map(keyOf), audited.units.map(keyOf));
});

test('a Vue SFC contributes both script and template units through the audit', () => {
  const { result } = auditUnitsOf(CASES[3][0], CASES[3][1]);
  const kinds = new Set(result.units.map((unit) => unit.kind));
  assert.ok(kinds.has('tmpl'), 'template units from sfc.template.ast');
  assert.ok(kinds.has('fn') || kinds.has('stmt'), 'script units from the overlay');
});

test('without a collector the audit runs no Forge work', () => {
  const content = fs.readFileSync(path.join(KIT_ROOT, CASES[0][0]), 'utf-8');
  const withForge = auditCode(content, path.join(KIT_ROOT, CASES[0][1]), CASES[0][1], { fingerprint: createFileFingerprint(CASES[0][1]) });
  const withoutForge = auditCode(content, path.join(KIT_ROOT, CASES[0][1]), CASES[0][1], { fingerprint: null });
  assert.deepEqual(withForge, withoutForge, 'fingerprinting never changes violations');
});
