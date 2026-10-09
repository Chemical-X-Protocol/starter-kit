// Assign every verified review finding to a plan group; fail loudly on any gap.
import fs from 'node:fs';

const [, , findingsPath, outPath] = process.argv;
const merged = JSON.parse(fs.readFileSync(findingsPath, 'utf-8'));

const GROUP = {
  // Phase 1
  G1: ['vue-sfc-typecheck-false-green', 'zero-tests-false-green', 'build-command-flag-ignored', 'verify-build-always-fails',
    'vitest-failure-extraction-loses-signal', 'test-scoping-args-dropped', 'watch-mode-silent-hang', 'runner-detection-wrong-runner',
    'verify-sequential-no-progress', 'test-failure-detail-dropped'],
  G2: ['patch-dollar-pattern-corruption', 'cli-write-truncates-on-missing-content', 'mcp-read-default-strip-corrupts', 'mcp-patch-dryrun-ignored',
    'patch-dryrun-ignored', 'symbol-extractor-wrong-block', 'reads-drop-line-positions', 'logic-enrich-emits-invalid-code',
    'write-symlink-parent-escape', 'patch-empty-target-and-ambiguity-ux', 'patch-nonatomic-no-locks', 'dry-run-no-diff-stale-audit',
    'cli-trace-connections-noop'],
  G3: ['batch-aborts-false-green', 'mcp-child-inherits-jsonrpc-stdin', 'child-inherits-mcp-stdin', 'batch-bypasses-call-scope',
    'mcp-json-runs-stale-package', 'wrappers-ignore-project-root', 'event-loop-blocking-no-progress', 'handler-throw-reported-as-parse-error',
    'mutation-classification-gaps', 'schema-doc-drift', 'output-envelope-token-waste', 'no-mcp-roots-support',
    'resources-subscribe-and-scorecard-fields', 'mcp-specs-cwd-dependent-and-gappy', 'mcp-boundary-caller-controlled', 'manifest-schema-drift',
    'wrappers-swallow-git-errors', 'mcp-stale-pinned-wrong-root', 'mcp-build-arbitrary-shell', 'wrapper-silent-empties'],
  G4: ['ui-unauth-sql-file-write', 'postinstall-clobbers-configs', 'mcp-postinstall-config-clobber', 'build-failure-issue-spam',
    'error-catcher-agent-noise', 'dependency-hygiene'],
  G5: ['ansi-leaks-into-agent-output', 'json-reports-bigger-than-raw', 'ansi-when-piped-root-cause', 'cli-ansi-and-header-noise',
    'startup-latency-eager-imports', 'tty-detection-isTTY-false', 'wrapper-startup-cost', 'cx-cmx-bins-never-published',
    'docs-drift-thresholds-tools', 'ansi-leak-non-tty', 'cli-startup-latency'],
  G6: ['mcp-q-never-syncs', 'blast-radius-like-false-positives', 'index-scope-leak-and-exclusions', 'subdir-runs-skip-sync',
    'no-index-versioning', 'literal-search-coverage', 'argv-parsing-wrong-query', 'undefined-binding-crashes', 'cold-index-no-transaction',
    'semantic-is-hashing', 'q-ranking-truncation-def-dump', 'hazards-false-green', 'memory-literal-dir', 'memory-dir-artifact',
    'index-upsert-no-transaction-race', 'stray-memory-dir', 'literal-search-not-grep', 'search-silently-partial-coverage', 'graph-output-noise'],
  // Phase 2
  B: ['blast-radius-recall-vue', 'vue-sfc-extraction-gaps', 'outline-incomplete-sfc-ts-scss', 'vue-sfc-blind-spots', 'swallowed-catch-fp-and-dup',
    'ratchet-not-rule-versioned', 'lifecycle-rules-inverted-on-vue', 'mhi-grade-not-intensive', 'nested-ternary-multi-report',
    'boolean-guard-doc-contradiction', 'line-budget-chaos', 'config-not-honored', 'wrong-directive-refs', 'two-pillar-taxonomies',
    'slop-phrase-fp', 'self-audit-ratchet-red'],
  K: ['cli-not-typechecked-real-referenceerrors'],
  T: ['telemetry-wrong-transcript', 'lease-clobbered-by-status-read', 'locks-no-real-exclusion', 'task-done-no-ownership-check',
    'lock-queue-duplicates', 'multiprocess-spec-cwd-dependent'],
  E: ['guard-hook-denies-grep', 'edit-path-loses-claude-code-guarantees', 'route-everything-unachievable-docs-drift'],
  // Phase 3
  C: ['tier-taxonomy-hardcoded', 'zero-raw-dom-not-audited', 'vue-generator-broken-output', 'vue-scaffold-red-out-of-box'],
  D: ['swarm-unused-scope-creep', 'tesseract-marketing'],
  // Phase 4
  H: ['benchmark-synthetic'],
  DECISION: ['calver-prerelease-semver'],
};

const owner = new Map();
for (const [group, ids] of Object.entries(GROUP)) for (const id of ids) owner.set(id, group);

const rows = [];
const missing = [];
for (const area of merged) {
  for (const f of area.findings) {
    const verdict = f.verdict?.verdict ?? 'unverified';
    const isRefuted = verdict === 'refuted';
    if (isRefuted) continue;
    const group = owner.get(f.id);
    const hasGroup = Boolean(group);
    if (!hasGroup) missing.push(`${area.area}/${f.id}`);
    rows.push({ group: group ?? '??', sev: f.verdict?.severity ?? f.severity, verdict, area: area.area, id: f.id, title: f.title });
  }
}
const ORDER = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'B', 'K', 'T', 'E', 'C', 'D', 'H', 'DECISION', '??'];
const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
rows.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || SEV[a.sev] - SEV[b.sev]);
const table = ['| Group | Sev | Verdict | Area | Finding id | Title |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
  ...rows.map((r) => `| ${r.group} | ${r.sev} | ${r.verdict} | ${r.area} | \`${r.id}\` | ${r.title.replace(/\|/g, '/')} |`)].join('\n');
fs.writeFileSync(outPath, table + '\n');
const groupCounts = JSON.stringify(Object.fromEntries(ORDER.map((g) => [g, rows.filter((r) => r.group === g).length]).filter(([, n]) => n)));
process.stdout.write(`${rows.length} findings mapped; per group: ${groupCounts}\n`);
const hasMissing = missing.length > 0;
if (hasMissing) {
  process.stderr.write(`UNMAPPED: ${missing.join(', ')}\n`);
  process.exit(1);
}
