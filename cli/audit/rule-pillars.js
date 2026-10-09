/**
 * One pillar taxonomy (finding two-pillar-taxonomies). The product pillars are the
 * 7 in pillars-schema.js, selected per project in `.chemx/config.json` `pillars`.
 * The 11 groupings in rules-registry.js are audit *categories* for reports, not
 * pillars. Each rule that enforces a product pillar is mapped here; when a project
 * disables that pillar, its rules are not reported. Unmapped rules (control flow,
 * security, accessibility, AI slop, hygiene) always run.
 */
export const RULE_PRODUCT_PILLARS = Object.freeze({
  LINE_BUDGET_FILE: 'lineBudgets',
  LINE_BUDGET_MOLECULE: 'lineBudgets',
  STRUCTURAL_WEIGHT_EXCEEDED: 'lineBudgets',
  VIEW_MONOLITH: 'tableOfContentsViews',
  RENDER_TREE_DEPTH_EXCEEDED: 'tableOfContentsViews',
  HOOK_SATURATION: 'composableContracts',
  HOOK_RETURN_OVERLOAD: 'composableContracts',
  HOOK_SHAPE_CONTRACT: 'composableContracts',
  HOOK_STATE_SATURATION: 'composableContracts',
  CONTROLLER_VIEW_MISMATCH: 'composableContracts'
});

/** Rule ids switched off by a `pillars` selection ({ lineBudgets: false, ... }). */
export const resolvePillarDisabledRules = (pillarSelection) => {
  const disabled = new Set();
  const hasSelection = pillarSelection !== null && typeof pillarSelection === 'object';
  if (!hasSelection) return disabled;
  for (const [rule, pillarKey] of Object.entries(RULE_PRODUCT_PILLARS)) {
    const isPillarOff = pillarSelection[pillarKey] === false;
    if (isPillarOff) disabled.add(rule);
  }
  return disabled;
};
