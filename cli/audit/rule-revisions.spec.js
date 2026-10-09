/**
 * Rule-set versioning guards (review of #1475): a rule added to RULE_REGISTRY must
 * land with a RULESET_VERSION bump and a RULE_REVISIONS entry, otherwise every
 * ratcheted project would see it regress from 0. The snapshot below is the registry
 * at the current RULESET_VERSION; changing the registry without bumping fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULESET_VERSION, RULE_REVISIONS, resolveRuleRevision } from './rule-revisions.js';
import { RULE_REGISTRY } from './rules-registry.js';

const REGISTRY_SNAPSHOT = Object.freeze({
  3: [
    'A11Y_CLICKABLE_NON_SEMANTIC', 'A11Y_IMAGE_MISSING_ALT', 'AI_SLOP_CONVERSATIONAL_ARTIFACT', 'AI_SLOP_ECHO_COMMENT',
    'AI_SLOP_LAZY_ANY', 'AI_SLOP_LAZY_PLACEHOLDER', 'AI_SLOP_REDUNDANT_PASSTHROUGH', 'AI_SLOP_SHALLOW_CATCH',
    'AI_SLOP_UTILITY_REINVENTION', 'COMBINATOR_RAW_BOOLEAN', 'COMPLEXITY_CYCLOMATIC_HIGH', 'CONTROLLER_VIEW_MISMATCH',
    'CONTROL_FLOW_DISPATCH_SWITCH', 'CONTROL_FLOW_INLINE_BOOLEAN', 'CONTROL_FLOW_NESTED_TERNARY', 'CONTROL_FLOW_SILENT_GUARD',
    'COUPLING_EXCESSIVE_INJECTION', 'DATA_FLOW_OPTIONAL_CHAINING_CHURN', 'ERROR_SWALLOWED_EXCEPTION', 'HOOK_RETURN_OVERLOAD',
    'HOOK_SATURATION', 'HOOK_SHAPE_CONTRACT', 'HOOK_STATE_SATURATION', 'ICON_SVG_STYLE_LEAK', 'LAYER_VIOLATION_CONTROLLER',
    'LIFECYCLE_ORPHANED_LISTENER', 'LINE_BUDGET_FILE', 'LINE_BUDGET_MOLECULE', 'NAMING_BARE_BOOLEAN', 'NAMING_HANDLER_PREFIX',
    'PROP_SURFACE_BLOAT', 'RAW_INLINE_STYLE', 'RENDER_HACK_TIMEOUT', 'RENDER_TREE_DEPTH_EXCEEDED',
    'SECURITY_DYNAMIC_CODE_EXECUTION', 'SECURITY_HARDCODED_SECRET', 'SECURITY_JAVASCRIPT_URL', 'SECURITY_RAW_HTML_INJECTION',
    'SECURITY_REVERSE_TABNABBING', 'SECURITY_SENSITIVE_LOGGING', 'STRUCTURAL_WEIGHT_EXCEEDED', 'SYNTAX_PARSE_ERROR',
    'SYNTHETIC_MOCK_DATA', 'TEST_FAKE_GREEN', 'TEST_MISSING_COLOCATED', 'TIMER_DISCIPLINE', 'TYPE_COLOCATION',
    'TYPOGRAPHY_EM_DASH', 'UNGUARDED_LOGGING', 'VIEW_MONOLITH'
  ]
});

const latestSnapshotVersion = Math.max(...Object.keys(REGISTRY_SNAPSHOT).map(Number));

test('the registry matches the snapshot recorded for the current RULESET_VERSION', () => {
  assert.equal(latestSnapshotVersion, RULESET_VERSION,
    'RULESET_VERSION changed: add a REGISTRY_SNAPSHOT entry for it (keep the older ones).');
  const current = Object.keys(RULE_REGISTRY).sort();
  const snapshot = [...REGISTRY_SNAPSHOT[RULESET_VERSION]].sort();
  const added = current.filter((rule) => !snapshot.includes(rule));
  const removed = snapshot.filter((rule) => !current.includes(rule));
  assert.deepEqual({ added, removed }, { added: [], removed: [] },
    'RULE_REGISTRY changed: bump RULESET_VERSION, set RULE_REVISIONS[<new rule>] to it and add a snapshot for it.');
});

test('rules added since the previous snapshot carry the revision that introduced them', () => {
  const versions = Object.keys(REGISTRY_SNAPSHOT).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < versions.length; i += 1) {
    const previous = new Set(REGISTRY_SNAPSHOT[versions[i - 1]]);
    const added = REGISTRY_SNAPSHOT[versions[i]].filter((rule) => !previous.has(rule));
    for (const rule of added) assert.ok(resolveRuleRevision(rule) >= versions[i], `${rule} needs RULE_REVISIONS >= ${versions[i]}`);
  }
});

test('RULE_REVISIONS names only registered rules and never exceeds RULESET_VERSION', () => {
  const unknown = Object.keys(RULE_REVISIONS).filter((rule) => !RULE_REGISTRY[rule]);
  assert.deepEqual(unknown, []);
  const revisions = Object.values(RULE_REVISIONS);
  assert.ok(revisions.every((rev) => Number.isInteger(rev) && rev >= 1 && rev <= RULESET_VERSION));
  assert.equal(Math.max(...revisions), RULESET_VERSION, 'RULESET_VERSION was bumped without any rule landing in it');
});
