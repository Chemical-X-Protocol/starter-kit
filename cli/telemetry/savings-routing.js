/**
 * Chemical X Protocol: the routing line of `chemx report savings` (#2498).
 * Routing savings = what the run cost on the models it actually used, against the SAME tokens priced as
 * if every call had run on a baseline model (default opus, the session's main model). The method is
 * "same tokens, different price". It is a price comparison, not a prediction: a run on the baseline
 * model would have had different turn counts, cache hits and output lengths.
 */
import { priceRun } from '../team/usage-compute.js';
import { DEFAULT_PRICING } from '../team/usage-pricing.js';

export const DEFAULT_BASELINE = 'opus';
/** Below this many agents the routing figure is shown but flagged as too little data. */
export const MIN_ROUTING_AGENTS = 5;

export const isKnownBaseline = (family) => Object.hasOwn(DEFAULT_PRICING, family);

const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');

const methodOf = (priced, baseline) => [
  'same tokens, different price:',
  `${fmtInt(priced.totals.total)} tokens from ${fmtInt(priced.totals.agents)} agents (usage counted once per message id),`,
  `priced per model actually used, against the same tokens priced as ${baseline};`,
  `prices: ${priced.pricingSource}.`,
  'Not a prediction: a run on the baseline model would have had different turns, cache hits and output.'
].join(' ');

const flagsOf = (priced, delta) => {
  const flags = [];
  const agents = priced.totals.agents;
  const unpriced = priced.totals.unpricedTokens;
  const isThin = agents < MIN_ROUTING_AGENTS;
  if (isThin) flags.push(`too little data: ${agents} agents (fewer than ${MIN_ROUTING_AGENTS}), read this line as an example, not a rate`);
  const missing = priced.missingTranscripts.length;
  const hasUnpriced = unpriced > 0;
  const hasMissing = missing > 0;
  const isBaselineCheaper = delta < 0;
  if (hasUnpriced) flags.push(`${fmtInt(unpriced)} tokens ran on a model with no price entry and are in neither figure`);
  if (hasMissing) flags.push(`${missing} of ${priced.journalAgents} journaled agents have no transcript and are not counted`);
  if (isBaselineCheaper) flags.push('the baseline would have been cheaper than the models actually used');
  return flags;
};

/** Pure routing math over a run priced by priceRun(run, pricing, baseline). */
export const routingLine = (priced) => {
  const baseline = priced.altFamily;
  const actual = priced.totals.cost;
  const atBaseline = priced.totals.costAlt;
  const delta = atBaseline - actual;
  const hasActual = actual > 0;
  return {
    baseline,
    actualUsd: actual,
    baselineUsd: atBaseline,
    savedUsd: delta,
    ratio: hasActual ? atBaseline / actual : null,
    agents: priced.totals.agents,
    tokens: priced.totals.total,
    unpricedTokens: priced.totals.unpricedTokens,
    byModel: priced.byModel.map((g) => ({ model: g.key, agents: g.agents, tokens: g.total, actualUsd: g.cost })),
    method: methodOf(priced, baseline),
    flags: flagsOf(priced, delta)
  };
};

/** Price a run read by readRun and return its routing line. */
export const routingSavings = (run, pricing, baseline = DEFAULT_BASELINE) => routingLine(priceRun(run, pricing, baseline));
