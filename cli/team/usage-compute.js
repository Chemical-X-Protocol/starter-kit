/**
 * Chemical X Protocol: price a measured run and roll it up per agent, handle and model (#2497).
 * cost_usd is each message bucket priced at the model that actually served it. costAlt is the same
 * tokens priced as if every call had run on altFamily (default opus), the "what if" comparison.
 * Unknown models are not priced: they add to unpricedTokens and to no dollar figure.
 */
import { emptyTokens } from './usage-transcript.js';
import { costOfTokens, familyOf } from './usage-pricing.js';

export const totalTokens = (t) => t.input + t.output + t.cacheRead + t.write5m + t.write1h;

const addInto = (target, t) => {
  target.input += t.input;
  target.output += t.output;
  target.cacheRead += t.cacheRead;
  target.write5m += t.write5m;
  target.write1h += t.write1h;
  target.calls += t.calls || 0;
};

const priceAgent = (agent, pricing, altFamily) => {
  const sum = emptyTokens();
  let cost = 0;
  let costAlt = 0;
  let unpricedTokens = 0;
  for (const [model, tokens] of Object.entries(agent.buckets)) {
    addInto(sum, tokens);
    const rates = pricing.table[familyOf(model)];
    const isPriced = Boolean(rates);
    cost += isPriced ? costOfTokens(tokens, rates) : 0;
    unpricedTokens += isPriced ? 0 : totalTokens(tokens);
    costAlt += costOfTokens(tokens, pricing.table[altFamily]) || 0;
  }
  const wall = { startedAt: agent.startedAt, endedAt: agent.endedAt, wallMs: agent.wallMs };
  return { agentId: agent.agentId, handle: agent.handle, label: agent.label, phase: agent.phase, model: agent.model, claims: agent.claims, ...sum, total: totalTokens(sum), cost, costAlt, unpricedTokens, ...wall };
};

const groupBy = (rows, keyOf) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || 'unknown';
    const group = groups.get(key) || { key, agents: 0, ...emptyTokens(), total: 0, cost: 0, costAlt: 0 };
    addInto(group, row);
    group.agents += 1;
    group.total += row.total;
    group.cost += row.cost;
    group.costAlt += row.costAlt;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost);
};

/** Price a run read by readRun. Totals count each message once; see usage-transcript.js. */
export const priceRun = (run, pricing, altFamily = 'opus') => {
  const rows = run.agents.map((agent) => priceAgent(agent, pricing, altFamily));
  const totals = groupBy(rows, () => 'all')[0] || { key: 'all', agents: 0, ...emptyTokens(), total: 0, cost: 0, costAlt: 0 };
  const naiveEntries = run.agents.reduce((n, a) => n + a.usageEntries, 0);
  const messages = run.agents.reduce((n, a) => n + a.messages, 0);
  return {
    runId: run.runId,
    altFamily,
    pricingSource: pricing.source,
    rows,
    totals: { ...totals, unpricedTokens: rows.reduce((n, r) => n + r.unpricedTokens, 0), messages, usageEntries: naiveEntries },
    byHandle: groupBy(rows, (r) => r.handle || '(no handle)'),
    byModel: groupBy(rows, (r) => familyOf(r.model) || r.model),
    journalAgents: run.journalAgents,
    missingTranscripts: run.missingTranscripts
  };
};
