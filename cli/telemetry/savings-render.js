/**
 * Chemical X Protocol: text card for `chemx report savings` (#2498).
 * Every line prints its method and the n behind it. Lines with too little data are flagged. Nothing
 * here extrapolates: a figure is either measured over n calls or agents, or it says it is not measured.
 */
import { KIND_METHODS, MIN_MEASURED_CALLS } from './savings-tooling.js';

const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtTime = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace('.000Z', 'Z') : 'unknown');

const routingLines = (r) => {
  const ratio = r.ratio === null ? 'n/a' : `${r.ratio.toFixed(1)}x`;
  return [
    `1. Routing (n = ${fmtInt(r.agents)} agents, ${fmtInt(r.tokens)} tokens)`,
    `   Actual ${fmtUsd(r.actualUsd)} vs ${fmtUsd(r.baselineUsd)} at ${r.baseline}: ${fmtUsd(r.savedUsd)} less, ${ratio} cheaper`,
    `   Method: ${r.method}`,
    ...r.flags.map((f) => `   Flag: ${f}`)
  ];
};

const actionLine = (a) => {
  const kind = a.kinds.join('+') || 'none';
  const saved = a.measured > 0 ? `${fmtInt(a.savedTokens)} tokens saved over ${fmtInt(a.measured)} measured (native ${fmtInt(a.counterfactualTokens)} vs chemx ${fmtInt(a.measuredResultTokens)})` : 'no token counterfactual';
  const avoided = a.validated > 0 ? `; ${fmtInt(a.callsAvoided)} separate check calls avoided over ${fmtInt(a.validated)} validated patches` : '';
  const thin = a.isThin && a.kinds.length > 0 ? `  [too little data: fewer than ${MIN_MEASURED_CALLS} measured]` : '';
  return `   ${a.action.padEnd(10)} n=${String(a.calls).padStart(4)} calls, returned ${fmtInt(a.resultTokens)} tokens; counterfactual ${kind}: ${saved}${avoided}${thin}`;
};

const methodLines = (actions) => {
  const used = new Set(actions.flatMap((a) => a.kinds));
  return Object.entries(KIND_METHODS).filter(([kind]) => used.has(kind)).map(([kind, text]) => `   Method (${kind}): ${text}`);
};

const totalsLines = (t) => [
  `   Overhead: chemx returned ${fmtInt(t.overheadTokens)} tokens over ${fmtInt(t.calls)} attributed calls (characters / 4, an estimate)`,
  `   Gross saving on ${fmtInt(t.measured)} measured calls: ${fmtInt(t.grossSavedTokens)} tokens`,
  `   Net saving: ${fmtInt(t.netSavedTokens)} tokens = gross minus ${fmtInt(t.unmeasuredTokens)} tokens returned by calls with no counterfactual (counted as pure cost)`
];

const dbLine = (d) => `     ${d.label}: ${d.error ? `not read (${d.error})` : `${fmtInt(d.calls)} calls in the run window, ${fmtInt(d.logged)} logged in total`}`;

const sourceLines = (c) => {
  const dbs = c.dbs ?? [];
  const failed = (c.dbsUnreadable ?? []).map((label) => `     ${label}: not read (could not be opened)`);
  const where = c.dbsRoot ? ` under ${c.dbsRoot}, searched to 4 levels deep` : '';
  return dbs.length === 0 ? [] : [`   Call dbs read (${dbs.length})${where}:`, ...dbs.map(dbLine), ...failed];
};

const toolingLines = (tooling) => {
  const c = tooling.coverage;
  const head = [`2. Tooling (n = ${fmtInt(tooling.totals.calls)} attributed calls, ${fmtInt(tooling.totals.measured)} with a token counterfactual)`, `   Coverage: ${c.note}`, ...sourceLines(c)];
  const isEmpty = tooling.totals.calls === 0;
  const share = Number.isFinite(c.unattributedShare) ? ` (${(c.unattributedShare * 100).toFixed(1)}% of ${fmtInt(c.loggedInWindow)} logged in the run window)` : '';
  const gap = `   Unattributed: ${fmtInt(c.unattributed)} logged calls in the run window carry no agent handle${share} and are not counted.`;
  const fix = c.reattribute ? [`   Reattribute: filled ${fmtInt(c.reattribute.updated)} calls from single-handle sessions; ${fmtInt(c.reattribute.ambiguousSessions)} sessions map to several handles and were left as they are. Counts above were read after this step.`] : ['   Reattribute: not run. Pass --reattribute to fill calls from sessions that map to exactly one handle (this writes to the call log).'];
  const body = isEmpty ? ['   No attributed calls: tooling savings are not measured for this run, and no figure is estimated.'] : [...tooling.actions.map(actionLine), ...methodLines(tooling.actions), ...totalsLines(tooling.totals)];
  return [...head, ...body, gap, ...fix];
};

export const renderSavingsCard = (report) => [
  `Savings report for run ${report.runId} (run window ${fmtTime(report.tooling.coverage.runStart)} to ${fmtTime(report.tooling.coverage.runEnd)})`,
  ...routingLines(report.routing),
  '',
  ...toolingLines(report.tooling),
  '',
  'Guaranteed: figures above are measured counts and list-price arithmetic over the n shown. Not guaranteed: what a different model or an agent without chemx would really have done. Nothing is extrapolated.'
].join('\n');
