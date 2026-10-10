/**
 * Chemical X Protocol: `chemx report savings --run=<wf_id|dir> [--json] [--baseline=<model>] [--projects=<dir>]` (#2498).
 * Joins the #2497 usage reader (what the run cost) with the tool_calls ledger (what chemx returned and
 * what the native alternative would have), and prints each line with its method and the n behind it.
 * Tooling figures cover only calls logged after call logging began; the report states that date.
 */
import { readRun } from '../team/usage-reader.js';
import { priceRun } from '../team/usage-compute.js';
import { loadPricing } from '../team/usage-pricing.js';
import { optionOf } from '../team/team-commands-tokens.js';
import { routingLine, DEFAULT_BASELINE, isKnownBaseline } from './savings-routing.js';
import { accountCalls, handleWindows } from './savings-tooling.js';
import { loadRunCallsFrom, openExtraLedgerDbs } from './savings-dbs.js';
import { renderSavingsCard } from './savings-render.js';
import { unattributedStats, reattributeCalls } from './call-ledger.js';

const USAGE = 'Usage: chemx report savings --run=<wf_id|run dir> [--json] [--baseline=opus|sonnet|haiku|fable] [--projects=<dir>] [--reattribute]';

const isoOf = (ms) => new Date(ms).toISOString();

const runWindowOf = (rows) => {
  const starts = rows.map((r) => r.startedAt).filter(Number.isFinite);
  const ends = rows.map((r) => r.endedAt).filter(Number.isFinite);
  return { start: Math.min(...starts), end: Math.max(...ends) };
};

/** Which part of the run window the call log covers, as one sentence. */
export const coverageNote = ({ loggedTotal, loggedFrom }, window) => {
  const hasWindow = Number.isFinite(window.start) && Number.isFinite(window.end);
  const rules = [
    [!hasWindow, 'the run has no timestamps, so calls cannot be attributed; tooling is not measured.'],
    [loggedTotal === 0, 'no chemx calls have been logged in the databases read yet; tooling is not measured for this run.'],
    [loggedFrom > window.end, `call logging began ${isoOf(loggedFrom)}, after this run ended (${isoOf(window.end)}); tooling is not measured for this run.`],
    [loggedFrom > window.start, `call logging began ${isoOf(loggedFrom)}, partway through this run (started ${isoOf(window.start)}). Only calls after that moment can appear; earlier calls were not recorded and are not estimated.`]
  ];
  const hit = rules.find(([isTrue]) => isTrue);
  return hit ? hit[1] : `call logging began ${isoOf(loggedFrom)}, before this run started: the whole run window is covered.`;
};

/** Build the report object from a run read by readRun and an open db. Pure apart from reading the db. */
export const buildSavingsReport = ({ run, pricing, baseline = DEFAULT_BASELINE, db, extraDbs = [], ownLabel = 'current db' }) => {
  const priced = priceRun(run, pricing, baseline);
  const window = runWindowOf(priced.rows);
  const loaded = loadRunCallsFrom([{ label: ownLabel, db }, ...extraDbs], handleWindows(priced.rows), window);
  const accounted = accountCalls(loaded.rows);
  return {
    runId: priced.runId,
    routing: routingLine(priced),
    tooling: {
      ...accounted,
      coverage: {
        runStart: window.start,
        runEnd: window.end,
        loggedFrom: loaded.loggedFrom,
        loggedTotal: loaded.loggedTotal,
        unattributed: loaded.unattributed,
        dbs: loaded.dbs,
        note: coverageNote(loaded, window)
      }
    }
  };
};

const fail = (message, isCli) => {
  if (isCli) process.stderr.write(`x ${message}\n${USAGE}\n`);
  return { error: message };
};

const argsProblem = (args) => {
  const run = optionOf(args, 'run');
  const baseline = optionOf(args, 'baseline') || DEFAULT_BASELINE;
  const isSavings = args[0] === 'savings';
  const problems = [
    [!isSavings, `Unknown report "${args[0] ?? ''}". Available: savings`],
    [!run, '--run=<wf_id|run dir> is required'],
    [!isKnownBaseline(baseline), `Unknown baseline "${baseline}" (known: opus, sonnet, haiku, fable)`]
  ];
  const hit = problems.find(([isTrue]) => isTrue);
  return { run, baseline, problem: hit ? hit[1] : null };
};

/** `chemx report ...`. The db is injected by the router; this module never opens one itself. */
export const runReportCli = (args, isCli, { db, cwd = process.cwd() } = {}) => {
  const { run: runId, baseline, problem } = argsProblem(args);
  if (problem) return fail(problem, isCli);
  const run = readRun(runId, optionOf(args, 'projects'));
  if (!run) return fail(`Run not found: ${runId}`, isCli);
  if (!db) return fail('SQLite database unavailable: the tool call log cannot be read.', isCli);
  const reattribute = args.includes('--reattribute') ? reattributeCalls(db) : null;
  const found = openExtraLedgerDbs(db, cwd);
  const report = buildSavingsReport({ run, pricing: loadPricing(cwd), baseline, db, extraDbs: found.extras, ownLabel: found.own });
  report.tooling.coverage.dbsUnreadable = found.failed;
  report.tooling.coverage.dbsRoot = found.root;
  const stats = unattributedStats(db, report.tooling.coverage.runStart, report.tooling.coverage.runEnd);
  report.tooling.coverage.loggedInWindow = stats.total;
  report.tooling.coverage.unattributedShare = stats.share;
  report.tooling.coverage.reattribute = reattribute;
  found.extras.forEach((e) => e.db.close());
  if (isCli) process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${renderSavingsCard(report)}\n`);
  return report;
};
