import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that once hardcoded a 100-line molecule budget and now follow the active profile.
const GUARDED_FILES = [
  'README.md',
  'STANDARDS.md',
  'app/components/molecules/funnel/funnel-system-layers-core.data.ts',
  'scripts/pre-commit.sh',
  'cli/audit/metrics.js',
  'cli/audit/prompts.js',
  'cli/audit/reporter-grades.js',
  'cli/audit/reporter-sections.js',
  'cli/audit/reporter-summary.js',
  'cli/audit/reporter-utils.js',
  'cli/audit/roadmap.js',
  'cli/audit/rules-helpers.js',
  'cli/audit/social.js',
  'cli/commands-schema.js',
  'cli/embeddings/vectorizer.js',
  'cli/generator.js',
  'cli/generator-help.js',
  'cli/generator-jig.js',
  'cli/generator-jig-cli.js',
  'cli/installer.js',
  'cli/installer-templates.js',
  'cli/mcp/manifests.js',
  'cli/mcp/prompts.js',
  'cli/navigator-conversion.js',
  'cli/navigator-guide.js',
  'cli/patcher.js',
  'cli/tesseract-manifesto.js'
];

const FIXED_100_CLAIMS = [
  /\b100[\s-]*(?:lines?|LOC|L)\b/i,
  /\b(?:under|approaching|exceeding)\s+100\b/i,
  /CONF_MAX_MOL:-100\b/,
  /maxMoleculeLineCount:\s*100\b/
];

// A line may still cite 100 lines when it names atomic-strict as the reason.
const isUnqualifiedClaim = (line) => {
  const isFixedClaim = FIXED_100_CLAIMS.some((pattern) => pattern.test(line));
  const isQualified = line.includes('atomic-strict');
  return isFixedClaim && !isQualified;
};

const findUnqualifiedClaims = (file, text) => text
  .split('\n')
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter(({ line }) => isUnqualifiedClaim(line))
  .map(({ line, lineNumber }) => `${file}:${lineNumber}: ${line}`);

describe('molecule budget guard: claim matcher', () => {
  it('catches the fixed 100-line wording these files used to carry', () => {
    const historicalClaims = [
      '* **Sliding-Scale Line Budgets:** Flags files exceeding 100, 500, or 1,000 lines (`LINE_BUDGET_FILE`).',
      '1. **Strict Molecular Line Budgets (< 100 Lines)**: Single-purpose files.',
      'Approaching 100 lines is a decomposition trigger.',
      '| `chemx_check` | Quality | Verify a single file against molecular boundary rules (< 100L, 2-stage booleans). |',
      '- Enforces the < 100 line molecule capsule limit, Two-Stage Booleans (Directive 3.A).',
      'Chemical X Standards verified: < 100 lines per file, granular domain types, co-located spec tests.',
      '2. Molecular Capsule Limit: Maximum 100 lines per molecule capsule file.',
      '2. Every new molecule component must stay under 100 lines.',
      'Invariants:    Guarantees <100 LOC limits, Result tuples, 2-stage booleans',
      "summary: 'Scaffold crystalline molecular capsules under 100 lines.',",
      'Raw DOM in molecules and files exceeding the 100-line budget',
      '100 lines is an outer bound per capsule file. Never write monoliths.',
      'MAX_MOLECULE_LINES="${CHEMX_MAX_MOLECULE_LINES:-${CONF_MAX_MOL:-100}}"',
      'saveProjectConfig(targetDir, { minGrade: opts.minGrade, maxLineCount: 500, maxMoleculeLineCount: 100 });'
    ];
    for (const claim of historicalClaims) {
      assert.ok(isUnqualifiedClaim(claim), `matcher missed: ${claim}`);
    }
  });

  it('ignores score text and lines that name atomic-strict', () => {
    const allowedLines = [
      '✔ AST Architecture:  A+ (100/100, 0 violations)',
      'All 7 Chemical X Molecular Architecture Pillars are 100% Compliant.',
      "description: 'Minimum acceptable score out of 100.'",
      'molecules use `LINE_BUDGET_MOLECULE` at the active profile budget (250 pragmatic, 100 atomic-strict)',
      '`--profile=atomic-strict` enforces a 100-line capsule cap.',
      'Each jig file stays <100 LOC (passes even atomic-strict), Result tuples, 2-stage booleans,'
    ];
    for (const line of allowedLines) {
      assert.ok(!isUnqualifiedClaim(line), `matcher flagged: ${line}`);
    }
  });
});

describe('molecule budget guard: fixed files do not restate a 100-line budget', () => {
  for (const file of GUARDED_FILES) {
    it(file, () => {
      const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      assert.deepStrictEqual(findUnqualifiedClaims(file, text), []);
    });
  }
});
