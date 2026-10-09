/**
 * Rule-set versioning for the ratchet. RULESET_VERSION increases whenever a rule is
 * added or a rule's semantics change in a way that can raise its count. Each such
 * rule records the ruleset version where its current semantics landed; rules not
 * listed have been stable since ruleset 1.
 *
 * A ratchet baseline recorded under an older revision of a rule does not gate that
 * rule: its current count is adopted as the new baseline instead of reported as a
 * regression (findings: ratchet-not-rule-versioned, self-audit-ratchet-red).
 *
 * rule-revisions.spec.js snapshots the RULE_REGISTRY ids per RULESET_VERSION, so adding
 * a rule without a bump fails the suite. At runtime a baseline also records every
 * registered rule's revision, so a rule it never saw is adopted, not a regression.
 */
export const RULESET_VERSION = 5;

export const RULE_REVISIONS = Object.freeze({
  // Ruleset 2: the 40-year canon rules (a3a1ac9, 9461ed2).
  DATA_FLOW_OPTIONAL_CHAINING_CHURN: 2,
  COMBINATOR_RAW_BOOLEAN: 2,
  // Ruleset 3: B precision passes and SFC template coverage.
  CONTROL_FLOW_SILENT_GUARD: 3,
  CONTROL_FLOW_INLINE_BOOLEAN: 3,
  CONTROL_FLOW_NESTED_TERNARY: 3,
  TIMER_DISCIPLINE: 3,
  LIFECYCLE_ORPHANED_LISTENER: 3,
  RAW_INLINE_STYLE: 3,
  LINE_BUDGET_FILE: 3,
  LINE_BUDGET_MOLECULE: 3,
  VIEW_MONOLITH: 3,
  SYNTAX_PARSE_ERROR: 3,
  RENDER_TREE_DEPTH_EXCEEDED: 3,
  A11Y_CLICKABLE_NON_SEMANTIC: 3,
  // Ruleset 4: catch family per truth spec 4.2 (binding-read escalation), annotations count
  // only inside comments and need a real reason, Stroustrup try-brace annotations.
  ERROR_SWALLOWED_EXCEPTION: 4,
  AI_SLOP_SHALLOW_CATCH: 4,
  // Ruleset 5: cascading guard detection and domain validator extraction (Directive 3.H).
  CONTROL_FLOW_CASCADE_GUARDS: 5
});

export const resolveRuleRevision = (rule) => RULE_REVISIONS[rule] ?? 1;
