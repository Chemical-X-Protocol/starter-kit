/**
 * Chemical X Protocol: text card for `chemx team audit-run` (#2561). Each section shows its count and up to
 * SHOWN evidence lines (agent label, handle, time, command); --json carries every row.
 */
import { clockTime } from './lease-lapse.js';

const SHOWN = 8;
const money = (n) => `$${Number(n).toFixed(2)}`;
const pct = (share) => (share === null ? 'n/a' : `${(share * 100).toFixed(1)}%`);
const at = (ms) => (Number.isFinite(ms) ? clockTime(ms) : '--:--:--');
const FILE_WIDTH = 80;
const short = (file) => (String(file).length > FILE_WIDTH ? `${String(file).slice(0, FILE_WIDTH)}...` : file);
const who = (row) => `${row.label || row.agentId} ${row.handle || ''}`.trim();

const list = (rows, line) => {
  const more = rows.length - SHOWN;
  const tail = more > 0 ? [`    ... ${more} more (use --json for all rows)`] : [];
  return [...rows.slice(0, SHOWN).map((row) => `    ${line(row)}`), ...tail];
};

const leaseLines = (leases) => {
  const head = '1. Leases';
  const isUnchecked = !leases.available;
  if (isUnchecked) return [head, `  not checked: ${leases.note}`];
  return [
    head,
    `  lapsed and edited afterwards (violation): ${leases.lapsed.length}`,
    ...list(leases.lapsed, (l) => `${at(l.expiresAt)} ${short(l.file)} held by ${l.handle} (${l.label || l.agentId})${l.editedAfterLapse ? ' [edited after the lapse]' : ''}`),
    `  info: lapsed with no edit afterwards (not a violation): ${leases.benign?.length ?? 0}`,
    ...list(leases.benign ?? [], (l) => `${at(l.expiresAt)} ${short(l.file)} held by ${l.handle}`),
    `  abandoned (expired after the holder finished): ${leases.abandoned.length}`,
    ...list(leases.abandoned, (l) => `${at(l.expiresAt)} ${short(l.file)} held by ${l.handle}`),
    `  waiters: ${leases.waiters.total}, starved or never granted: ${leases.waiters.starved.length}`,
    ...list(leases.waiters.starved, (w) => `${at(w.requestedAt)} ${w.waiter} waited ${Math.round(w.waitedMs / 60000)}m for ${w.file}${w.holder ? ` held by ${w.holder}` : ''}${w.granted ? '' : ' (not granted)'}`),
    `  note: ${leases.note}`
  ];
};

const bypassLines = (b) => [
  '2. Bypasses',
  `  shell writes into repo files: ${b.shell.length}`,
  ...list(b.shell, (x) => `${at(x.at)} ${who(x)} ${x.how} -> ${x.target}`),
  `  native tools on repo files: ${b.native.length}`,
  ...list(b.native, (x) => `${at(x.at)} ${who(x)} ${x.how} ${x.target}`),
  `  guard-bypass events: ${b.guard.length}`,
  ...list(b.guard, (x) => `${at(x.at)} ${x.handle} [${x.rule ?? 'rule?'}] ${x.reason}`)
];

const top = (rows) => rows.slice(0, SHOWN).map((r) => `${r.command} x${r.count}`).join(', ') || 'none';

const adoptionLines = (a) => [
  '3. Adoption',
  `  chemx share of work calls: ${pct(a.share)} (${a.chemx} chemx, ${a.covered} native with a chemx equivalent, ${a.gap} with none; ${a.scratch} scratch and ${a.neutral} plumbing left out)`,
  `  covered natives: ${top(a.coveredByCommand)}`,
  `  gaps (no chemx equivalent in this map): ${top(a.gapsByCommand)}`
];

const protocolLines = (p) => [
  '4. Protocol gaps',
  `  commits without a task id: ${p.uncommitted.length}`,
  ...list(p.uncommitted, (c) => `${at(c.at)} ${who(c)} ${c.command}`),
  `  edits without a lease: ${p.unleasedEdits.length}`,
  ...list(p.unleasedEdits, (e) => `${at(e.at)} ${who(e)} ${e.verb} ${e.file}`),
  `  claims never closed: ${p.unclosedClaims.length}`,
  ...list(p.unclosedClaims, (c) => `${who(c)} task #${c.task}`)
];

const hijackLines = (hijacks) => [
  '5. Relayed-message hijack suspects',
  `  likely: ${hijacks.filter((h) => h.level === 'likely').length}, possible: ${hijacks.filter((h) => h.level === 'possible').length}`,
  ...list(hijacks, (h) => `${h.level} ${who(h)} [${h.signals.join(', ')}] ${h.steps} steps ${money(h.cost)}: ${h.final}`)
];

const costLines = (cost) => [
  '6. Cost and steps',
  `  total ${money(cost.totalCost)}, ${cost.totalTokens} tokens, ${cost.perAgent.length} agents`,
  ...list(cost.perAgent, (a) => `${who(a)} ${a.steps} steps ${money(a.cost)}`)
];

export const renderAuditRun = (report) => {
  const missing = report.missingTranscripts.length;
  const benign = report.leases.benign?.length ?? 0;
  const info = benign ? ` (info: ${benign} lease lapse${benign === 1 ? '' : 's'} with no edit afterwards, not counted)` : '';
  const verdict = (report.ok ? 'no guarantee violated' : `VIOLATED: ${report.violations.join('; ')}`) + info;
  return [
    `Audit of run ${report.runId} (${report.agents} agents${missing ? `, ${missing} transcripts missing` : ''})`,
    verdict, '',
    ...leaseLines(report.leases), '',
    ...bypassLines(report.bypasses), '',
    ...adoptionLines(report.adoption), '',
    ...protocolLines(report.protocol), '',
    ...hijackLines(report.hijacks), '',
    ...costLines(report.cost)
  ].join('\n');
};
