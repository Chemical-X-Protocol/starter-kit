/**
 * Chemical X Protocol: `chemx team audit-run --run=<wf_id|dir> [--json] [--no-fail] [--projects=<dir>]` (#2561).
 * Audits a finished swarm from its transcripts (the #2497 run reader) and, when the coordination db is
 * available, its lease records. Sections: lease lapses and starved waiters, real chemx bypasses, adoption,
 * protocol gaps, hijack suspects, cost and steps per agent. Pure read: it writes nothing.
 *
 * The exit code is 1 when a guarantee was violated: a lease lapsed under an active holder, a starved waiter, a
 * shell or native bypass or a guard-bypass event, an edit without a lease, a commit without a task id, a
 * claim never closed, or a likely hijack; --no-fail reports only (--strict is accepted, the default). Adoption and `possible` hijacks are reported, never a failure.
 * Every section states what it could not see: without a db the lease sections say so instead of reporting 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readRun } from './usage-reader.js';
import { priceRun } from './usage-compute.js';
import { loadPricing } from './usage-pricing.js';
import { readTranscriptCalls, isOverheadTool } from './audit-run-calls.js';
import { invocationsOf } from './audit-run-invocations.js';
import { repoRootsOf, shellWritesOf, nativeBypassOf } from './audit-run-bypass.js';
import { classifyInvocation, summarizeAdoption } from './audit-run-adoption.js';
import { commitsWithoutTask, editsWithoutLease, unclosedClaims, hijackSignals } from './audit-run-protocol.js';
import { optionOf } from './team-commands-tokens.js';
import { openTeamContext } from './coordination-db.js';
import { renderAuditRun } from './audit-run-render.js';
import { leaseLapses, leaseWaiters, guardBypasses, leasesTaken, taskStatuses } from './audit-run-db.js';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const isEmpty = sorted.length === 0;
  const pair = [sorted[mid - 1] ?? 0, sorted[mid] ?? 0];
  const isOdd = sorted.length % 2 === 1;
  const picked = isOdd ? sorted[mid] : (pair[0] + pair[1]) / 2;
  return isEmpty ? 0 : picked;
};

const readAgentCalls = (run, agent) => {
  const file = path.join(run.dir, `agent-${agent.agentId}.jsonl`);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // chemx-allow: best-effort a transcript that vanished after readRun is audited as empty
  }
  return readTranscriptCalls(text);
};

const who = (agent) => ({ agentId: agent.agentId, handle: agent.handle, label: agent.label });

const bypassesOf = (invs, agent, roots, home) => {
  const found = [];
  for (const inv of invs) {
    const shell = shellWritesOf(inv, roots, home).map((w) => ({ ...who(agent), type: 'shell-write', how: w.how, target: w.target }));
    const native = nativeBypassOf(inv, roots, home);
    const nativeItem = native ? [{ ...who(agent), type: 'native-tool', how: native.how, target: native.target }] : [];
    for (const item of [...shell, ...nativeItem]) found.push({ ...item, at: inv.at, command: inv.raw.replace(/\s+/g, ' ').slice(0, 200) });
  }
  return found;
};

const claimedIds = (invs) => invs.filter((i) => i.kind === 'chemx' && i.argv[0] === 'team' && i.argv[2] === 'claim').map((i) => Number(i.argv[3])).filter(Number.isFinite);

const auditAgent = (run, agent, row, ctx) => {
  const parsed = readAgentCalls(run, agent);
  const invs = parsed.calls.flatMap(invocationsOf);
  const classified = invs.map(classifyInvocation);
  const steps = parsed.calls.filter((c) => !isOverheadTool(c.name)).length;
  const statuses = ctx.db ? taskStatuses(ctx.db, claimedIds(invs)) : new Map();
  const taken = ctx.taken.get(agent.handle) ?? [];
  return {
    agent: { ...who(agent), steps, cost: row.cost, tokens: row.total, wallMs: row.wallMs, startedAt: row.startedAt, endedAt: row.endedAt },
    classified,
    bypasses: bypassesOf(invs, agent, ctx.roots, ctx.home),
    commits: commitsWithoutTask(invs).map((c) => ({ ...who(agent), ...c })),
    unleased: editsWithoutLease(invs, taken).map((e) => ({ ...who(agent), ...e })),
    unclosed: unclosedClaims(invs, statuses).map((id) => ({ ...who(agent), task: id })),
    parsed, steps
  };
};

const hijacksOf = (audits, medianCost) => audits.map((a) => {
  const { level, signals } = hijackSignals({ ...a.parsed, workCalls: a.steps, cost: a.agent.cost, medianCost });
  return level ? { ...a.agent, level, signals, final: (a.parsed.finalOutput ? JSON.stringify(a.parsed.finalOutput) : a.parsed.finalText).slice(0, 160) } : null;
}).filter(Boolean);

const leaseSection = (db, agents, starveMs) => {
  if (!db) return { available: false, note: 'no coordination db was readable, so lease lapses and waiters were not checked', lapsed: [], abandoned: [], waiters: { total: 0, starved: [] } };
  const lapses = leaseLapses(db, agents);
  return { available: true, note: 'from the feed: only lapses recorded by a build that writes lock_expired and not archived are visible', lapsed: lapses.filter((l) => l.kind === 'lapsed'), abandoned: lapses.filter((l) => l.kind === 'abandoned'), waiters: leaseWaiters(db, agents, { starveMs }) };
};

const violationsOf = (r) => [
  [r.leases.lapsed.length, 'lease lapsed under an active holder'],
  [r.leases.waiters.starved.length, 'waiter starved or never granted'],
  [r.bypasses.shell.length + r.bypasses.native.length, 'chemx bypass (shell write or native tool on a repo file)'],
  [r.bypasses.guard.length, 'guard-bypass event'],
  [r.protocol.uncommitted.length, 'commit without a task id'],
  [r.protocol.unleasedEdits.length, 'edit without a lease'],
  [r.protocol.unclosedClaims.length, 'claim never closed'],
  [r.hijacks.filter((h) => h.level === 'likely').length, 'likely relayed-message hijack']
].filter(([count]) => count > 0).map(([count, what]) => `${count} x ${what}`);

/**
 * Audit a run read by readRun. ctx: { db, pricing, home, repoRoots, starveMs }.
 * @returns {object} the report (see the section names above); report.violations is empty when ok
 */
export const auditRun = (run, ctx = {}) => {
  const priced = priceRun(run, ctx.pricing ?? loadPricing(process.cwd()), 'opus');
  const rows = new Map(priced.rows.map((row) => [row.agentId, row]));
  const cwds = run.agents.flatMap((a) => readAgentCalls(run, a).calls.map((c) => c.cwd));
  const full = { db: ctx.db ?? null, home: ctx.home, roots: repoRootsOf(new Set(cwds), ctx.repoRoots ?? []) };
  full.taken = full.db ? leasesTaken(full.db, priced.rows) : new Map();
  const audits = run.agents.map((agent) => auditAgent(run, agent, rows.get(agent.agentId), full));
  const medianCost = median(audits.map((a) => a.agent.cost));
  const isLargeEnough = audits.length >= 4;
  const report = {
    runId: run.runId, dir: run.dir, agents: audits.length, missingTranscripts: run.missingTranscripts,
    leases: leaseSection(full.db, priced.rows, ctx.starveMs),
    bypasses: { shell: audits.flatMap((a) => a.bypasses.filter((b) => b.type === 'shell-write')), native: audits.flatMap((a) => a.bypasses.filter((b) => b.type === 'native-tool')), guard: full.db ? guardBypasses(full.db, priced.rows) : [] },
    adoption: summarizeAdoption(audits.flatMap((a) => a.classified)),
    protocol: { uncommitted: audits.flatMap((a) => a.commits), unleasedEdits: audits.flatMap((a) => a.unleased), unclosedClaims: audits.flatMap((a) => a.unclosed) },
    hijacks: hijacksOf(audits, isLargeEnough ? medianCost : 0),
    cost: { totalCost: priced.totals.cost, totalTokens: priced.totals.total, perAgent: audits.map((a) => a.agent).sort((x, y) => y.cost - x.cost) }
  };
  report.violations = violationsOf(report);
  report.ok = report.violations.length === 0;
  return report;
};

const AUDIT_USAGE = 'Usage: chemx team audit-run --run=<wf_id|run dir> [--json] [--no-fail] [--projects=<dir>]';

export const handleAuditRun = (db, opts, isCli, cwd = process.cwd()) => {
  const run = readRun(opts.run, opts.projects);
  if (!run) {
    const message = `Run not found: ${opts.run} (looked for a directory, then ~/.claude/projects/*/*/subagents/workflows/<id>)`;
    if (isCli) process.stderr.write(`x ${message}\n${AUDIT_USAGE}\n`);
    return { error: message };
  }
  const report = auditRun(run, { db, pricing: loadPricing(cwd) });
  const body = opts.json ? JSON.stringify(report, null, 2) : renderAuditRun(report);
  if (isCli) process.stdout.write(`${body}\n`);
  const isFailure = !opts.noFail && !report.ok;
  const shouldFail = isCli && isFailure;
  if (shouldFail) process.exitCode = 1;
  return report;
};

/** Entry for `chemx team audit-run`: parses the args after the command word; the db is null when none opens. */
export const runAuditRunCli = (restArgs, flags, isCli, cwd = process.cwd()) => {
  const run = optionOf(restArgs, 'run');
  const isMissing = !run;
  if (isMissing) {
    if (isCli) process.stderr.write(`x --run is required\n${AUDIT_USAGE}\n`);
    if (isCli) process.exitCode = 1;
    return { error: '--run is required' };
  }
  const ctx = openTeamContext(cwd);
  const opts = { run, projects: optionOf(restArgs, 'projects'), json: Boolean(flags.isJson), noFail: restArgs.includes('--no-fail') };
  const result = handleAuditRun(ctx.db ?? null, opts, isCli, cwd);
  const shouldFail = isCli && Boolean(result.error);
  if (shouldFail) process.exitCode = 1;
  return result;
};
