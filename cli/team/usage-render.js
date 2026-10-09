/**
 * Chemical X Protocol: text card for `chemx team tokens --run=<id>` (#2497).
 * Every total names its method: usage deduped by message id; prices from <source>.
 */

const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const pad = (text, width) => String(text).padEnd(width);
const padL = (text, width) => String(text).padStart(width);

const fmtWall = (ms) => {
  const seconds = Math.round((ms || 0) / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};

const shortModel = (model) => String(model).replace(/^claude-/, '');

const agentLine = (r) => {
  const who = `${r.handle || '(no handle)'} ${r.label}`.trim().slice(0, 44);
  const writes = r.write5m + r.write1h;
  return [pad(who, 45), pad(shortModel(r.model), 14), padL(fmtInt(r.input), 7), padL(fmtInt(r.output), 9),
    padL(fmtInt(r.cacheRead), 12), padL(fmtInt(writes), 10), padL(r.calls, 5), padL(fmtWall(r.wallMs), 7), padL(fmtUsd(r.cost), 8)].join(' ');
};

const AGENT_HEADER = [pad('agent', 45), pad('model', 14), padL('in', 7), padL('out', 9), padL('cache read', 12), padL('cache wr', 10), padL('calls', 5), padL('wall', 7), padL('cost', 8)].join(' ');

const groupLine = (g, alt) => `  ${pad(g.key, 40)} ${padL(g.agents, 4)} agents ${padL(fmtInt(g.total), 14)} tokens ${padL(fmtUsd(g.cost), 9)} actual ${padL(fmtUsd(g.costAlt), 9)} at ${alt}`;

const section = (title, groups, alt) => [`${title}:`, ...groups.map((g) => groupLine(g, alt))];

const totalsLines = (priced) => {
  const t = priced.totals;
  const alt = priced.altFamily;
  const method = `usage deduped by message id (${fmtInt(t.messages)} messages from ${fmtInt(t.usageEntries)} transcript entries); prices from ${priced.pricingSource}`;
  return [
    `Totals: ${fmtInt(t.agents)} agents, ${fmtInt(t.total)} tokens, ${fmtUsd(t.cost)} actual, ${fmtUsd(t.costAlt)} if every call had run on ${alt}`,
    `  tokens by kind: input ${fmtInt(t.input)}, output ${fmtInt(t.output)}, cache read ${fmtInt(t.cacheRead)}, cache write 5m ${fmtInt(t.write5m)}, cache write 1h ${fmtInt(t.write1h)}`,
    `  ${method}`
  ];
};

const gapLines = (priced) => {
  const lines = [];
  const missing = priced.missingTranscripts.length;
  if (missing) lines.push(`Not guaranteed: ${missing} of ${priced.journalAgents} journaled agents have no transcript, so they are not counted.`);
  const unpriced = priced.totals.unpricedTokens;
  if (unpriced) lines.push(`Not guaranteed: ${fmtInt(unpriced)} tokens ran on a model with no price entry and add no dollars.`);
  return lines;
};

export const renderRunCard = (priced, { top } = {}) => {
  const sorted = [...priced.rows].sort((a, b) => b.cost - a.cost);
  const shown = Number.isFinite(top) ? sorted.slice(0, top) : sorted;
  const hidden = sorted.length - shown.length;
  return [
    `Token usage for run ${priced.runId}`,
    AGENT_HEADER,
    ...shown.map(agentLine),
    ...(hidden ? [`... ${hidden} more agents (use --json for all rows)`] : []),
    '',
    ...section('By handle', priced.byHandle.slice(0, 15), priced.altFamily),
    '',
    ...section('By model', priced.byModel, priced.altFamily),
    '',
    ...totalsLines(priced),
    ...gapLines(priced)
  ].join('\n');
};
