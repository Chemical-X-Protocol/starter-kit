import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeLineBudgetPolicy } from './config/profiles.js';
import { MCP_TOOLS } from './mcp/manifests.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(KIT_ROOT, rel), 'utf8');

// Everything a person or agent reads as guidance: docs, shims, help, footers and hints.
const GUIDANCE_FILES = [
  'README.md', 'AGENTS.md', 'STANDARDS.md', 'llms.txt', 'CLAUDE.md', '.cursorrules', '.github/copilot-instructions.md',
  'cli/commands-schema-search.js', 'cli/commands-schema-edit.js', 'cli/commands-schema-verify.js',
  'cli/commands-schema-wrappers.js', 'cli/commands-schema-ops.js', 'cli/commands-schema-team.js',
  'cli/help.js', 'cli/host-shims.js', 'cli/generator-help.js', 'cli/generator.js',
  'cli/navigator-guide.js', 'cli/navigator-conversion.js', 'cli/tesseract-manifesto.js', 'cli/lattice-directives.js',
  'cli/commands/cmd-wrappers.js', 'cli/commands/cmd-wrappers-git.js', 'cli/commands/cmd-wrappers-files.js',
  'cli/commands/cmd-wrappers-json.js', 'cli/commands/cmd-batch.js', 'cli/reader.js', 'cli/search.js',
  'cli/generator-jig-cli.js', 'cli/generator-jig.js', 'cli/audit/roadmap.js', 'cli/mcp/manifests.js',
  'cli/mcp/manifests-analysis.js', 'cli/mcp/manifests-runners.js', 'cli/mcp/manifests-team.js', 'cli/embeddings/vectorizer.js',
  'cli/mcp/prompts.js', 'cli/audit/prompts.js'
];
// Not scanned yet: audit/social.js (share-card prose), and the audit reporters and rules-helpers,
// whose "100 lines" labels describe the threshold metrics.js actually computes.

const scan = (pattern, { allow = () => false } = {}) => GUIDANCE_FILES.flatMap((rel) =>
  read(rel).split('\n').flatMap((line, index) => {
    const isHit = pattern.test(line) && !allow(line);
    return isHit ? [`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
  }));

test('docs drift: guidance names the published chemx binary, never cx or cmx', () => {
  const pkg = JSON.parse(read('package.json'));
  const publishScript = read('scripts/publish-both.mjs');
  const isAliasPublished = (alias) => Boolean(pkg.bin?.[alias]) && publishScript.includes(`${alias}:`);
  const unpublished = ['cx', 'cmx'].filter((alias) => !isAliasPublished(alias));
  const aliasPattern = new RegExp(`(^|[\\s\`'"(])(${unpublished.join('|')}) [a-z-]`);
  assert.deepStrictEqual(scan(aliasPattern), []);
});

// A flat 100-line claim in any wording guidance used to carry. cli/audit/line-budgets.spec.js
// scans its report files with this same pattern (matcher ported from 15dabc9).
const FLAT_CAP = /<\s*100\s*(lines?|LOC|L\b)|\b100[\s-]*(lines?|LOC|L)\b|\b(under|approaching|exceeding)\s+100\b/i;
// atomic-strict really caps capsules at 100 lines, and the read window is a tool budget (AGENTS.md 1.N).
const isLegitimate100 = (line) => /atomic-strict|read window|100-line window/.test(line);
const isFlatCapClaim = (line) => FLAT_CAP.test(line) && !isLegitimate100(line);

test('docs drift: the flat-cap matcher catches the 100-line wording guidance used to carry', () => {
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
    'Molecules have a 100-line cap.',
    "description: 'Scaffolds complete crystalline capsules containing SFC (<100 LOC), reactive controller hook, mixin SCSS, and types.',"
  ];
  assert.deepStrictEqual(historicalClaims.filter((claim) => !isFlatCapClaim(claim)), [], 'every historical claim is caught');
});

test('docs drift: the flat-cap matcher spares scores, atomic-strict lines and the read window', () => {
  const legitimateLines = [
    '✔ AST Architecture:  A+ (100/100, 0 violations)',
    'All 7 Chemical X Molecular Architecture Pillars are 100% Compliant.',
    "description: 'Minimum acceptable score out of 100.'",
    'Any file above 500 lines is a monolith warning (HIGH at 1,000, CRITICAL at 2,000).',
    'Wait up to 100ms between polls.',
    'molecules use `LINE_BUDGET_MOLECULE` at the active profile budget (250 pragmatic, 100 atomic-strict)',
    '`--profile=atomic-strict` enforces a 100-line capsule cap.',
    'Each jig file stays <100 LOC (passes even atomic-strict), Result tuples, 2-stage booleans,',
    'Files longer than the chemx read window (100 lines by default) render an AST outline.',
    'A file over the 100-line window reads as an outline; --full returns the whole file.'
  ];
  assert.deepStrictEqual(legitimateLines.filter(isFlatCapClaim), [], 'no legitimate line is flagged');
});

test('docs drift: line budgets state the canonical AGENTS.md policy, not a flat 100-line cap', () => {
  const hits = scan(FLAT_CAP, { allow: isLegitimate100 });
  assert.deepStrictEqual(hits, []);
  const policy = describeLineBudgetPolicy();
  assert.match(policy, /250 lines/);
  for (const rel of ['README.md', 'STANDARDS.md']) {
    assert.ok(read(rel).includes(policy), `${rel} states the canonical line-budget sentence`);
  }
});

test('docs drift: --version names the chemx binary it runs as', () => {
  const run = spawnSync(process.execPath, [path.join(KIT_ROOT, 'cli', 'index.js'), '--version'], { encoding: 'utf8' });
  const { version } = JSON.parse(read('package.json'));
  assert.strictEqual(run.stdout, `chemx v${version}\n`);
});

test('docs drift: README documents the single chemx MCP tool and every action it accepts', () => {
  const readme = read('README.md');
  const start = readme.indexOf('### The `chemx` MCP Tool');
  assert.ok(start > 0, 'README has a "The `chemx` MCP Tool" section');
  const section = readme.slice(start, readme.indexOf('\n### ', start + 5));
  assert.doesNotMatch(readme, /\(\d+ Tools\)/, 'README must not advertise a tool count');
  assert.strictEqual(MCP_TOOLS.length, 1);
  const actions = MCP_TOOLS[0].inputSchema.properties.action.enum;
  const missing = actions.filter((action) => !section.includes(`\`${action}\``));
  assert.deepStrictEqual(missing, [], 'every MCP action appears in the README table');
});
