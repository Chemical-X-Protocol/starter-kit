// Text rendering for `chemx test`. One headline per verdict, so the counts never contradict it.
import { ANSI } from './theme.js';
import { STATUS, isPass, isInconclusive } from './result-status.js';
import { formatProfile } from './test-profile.js';
import { sharedRunNote } from './job-line-text.js';

export const TEST_HELP = [
  `${ANSI.BOLD}USAGE${ANSI.RESET}`,
  '  chemx test [targets...] [options] [-- <command>]',
  '',
  `${ANSI.BOLD}TARGETS${ANSI.RESET}`,
  '  Any positional argument is passed to the runner as a target (file path, or a',
  '  file-name filter for vitest/jest). A target that matches nothing is inconclusive.',
  '',
  `${ANSI.BOLD}OPTIONS${ANSI.RESET}`,
  '  -t <name>, -t=<name>     Only run tests whose name matches (alias: --filter); extra words after it join the',
  '                           name, paths and spec files among them stay targets (-t login a.spec.js)',
  '  --target=<path>          Explicit target (same as a positional)',
  '  --changed                Run only the specs affected by files changed vs HEAD (staged,',
  '                           unstaged, untracked), plus the meta specs that scan the whole repo; on a clean',
  '                           tree it compares with the merge base of origin/main (or origin/master) and says',
  '                           so; --base=<rev> compares from the merge base with that revision instead',
  '  --related <files...>     Run only the specs affected by these files (specs or sources)',
  '  --depth=<n>              With --changed/--related: keep only specs within n import hops of the',
  '                           change (fast inner loop; deeper specs are listed as NOT run)',
  '  --all                    Run both lanes (fast + slow): everything the test script runs; with --changed, the',
  '                           affected set in both lanes (what CI runs for a pull request)',
  '  --slow                   Run only the slow lane (specs that spawn the CLI/MCP server,',
  '                           stress and timing specs), as declared in test-lanes.json',
  '  --profile [--top=<n>]    Wall time per spec file, slowest first (lane: default, --all, --slow)',
  '  --slots                  List who holds the shared test worker slots, who is queued and the heavy',
  '                           line (handle, task, age, joined); with --json, as JSON. Runs no tests',
  '  --wait-timeout=<seconds> Give up queueing after this long (a light run waits 600 by default; a full',
  '                           suite waits as long as it takes unless this is given; 0 = no limit).',
  '                           Result: inconclusive, "queued too long, held by <handle>"; no tests ran',
  '  --allow-empty            Treat a run that collects zero tests as a pass',
  '  --timeout=<seconds>      Stop the run after this long (result: inconclusive)',
  '  --json                   Output the test summary as JSON',
  '  --raw                    Stream the runner output as it runs',
  '  -h, --help               Show this help message',
  '',
  `${ANSI.BOLD}WORKER BUDGET${ANSI.RESET}`,
  '  All chemx test runs on this machine share floor(cores/2) workers (CHEMX_TEST_CONCURRENCY',
  '  overrides). A light run takes free slots from os.tmpdir()/chemx-test-slots, passes the count to',
  '  the runner (--test-concurrency / --maxWorkers) and waits when none is free, printing one status line',
  '  to stderr (holders, queue position, "[job <pid>: chemx wait --job=<pid>]") and again only when that',
  '  changes. Holders refresh a heartbeat every 10s; one',
  '  silent for 60s is reclaimed even if its pid is alive. Over MCP, a call that finds no free slot',
  '  returns {queued:true, position, retryCommand} after about 1.5s instead of blocking; run the',
  '  retryCommand later. A light run that waited 60s+ posts a "test-queue" feed event when a team db resolves.',
  '',
  `${ANSI.BOLD}THE LINE${ANSI.RESET}`,
  '  The budget splits into two lanes. A run with named targets (a spec file or directory) is light: it',
  '  takes free slots at once and never waits behind a full suite. A run with no named targets (the full',
  '  suite), a typecheck and a build are heavy: each takes a ticket and runs one at a time, first come',
  '  first served, holding the budget less CHEMX_LIGHT_RESERVE slots (default 2; at least 1 each way when',
  '  the budget is 2 or more) and telling the runner that many workers. The reserve stays free for light runs, and',
  '  its last slot for small ones: a light run naming smallRun (test-lanes.json, default 5) or more spec files, a',
  '  directory or a glob never takes it, so a run naming one spec does not queue behind another agent\'s --changed.',
  '  Waiting prints "chemx: in line #<n> for <kind> (budget <b>, heavy <h>): running <kind> for <who> <age>;',
  '  ahead: <kinds>" to stderr once (again only when the line changes). A heavy request for the same project and command as a ticket that has',
  '  not started joins it: one run serves every caller, and each prints "chemx: shared run (owner <who>,',
  '  <n> joined)" (JSON: sharedRun {owner, joined, seq}). A request that comes after the run started',
  '  takes a ticket of its own. A chemx run inside a heavy run is covered by its slots and does not wait.',
  '',
  `${ANSI.BOLD}A REPO'S OWN RUNNER${ANSI.RESET}`,
  '  A repo whose tests/run-tests.mjs imports a harness (`import { harness } from ...`), registers test files',
  '  (`import \'./x.test.mjs\';`) and calls harness.run() runs through that runner, with no package.json or',
  '  node_modules needed. `chemx test` runs it whole; `chemx test tests/x.test.mjs` (or a directory, or `-t <name>`)',
  '  runs a generated copy of the runner inside tests/ (.chemx-run-<hash>.mjs, removed after) that registers only',
  '  those files, so the failures-only output and the one-line summary are the runner\'s own. These runs always',
  '  take a ticket in the line (one at a time on the machine), even for one file: their suites share a database.',
  '  .chemxrc { "test": { "runners": ["node tests/run-tests.mjs"] } } keeps the guard from nudging that raw call.',
  '',
  `${ANSI.BOLD}PNPM${ANSI.RESET}`,
  '  When the jest config (or its preset) names a snapshot serializer, transform or setup file that only',
  '  node_modules/.pnpm/node_modules holds, a test run gets that directory on NODE_PATH. A project without',
  '  node_modules says so in one line (in a git worktree it names the symlink to the main checkout\'s).',
  '',
  `${ANSI.BOLD}EXIT CODES${ANSI.RESET}`,
  '  0 pass, 1 fail, 3 inconclusive (no tests ran, timeout)',
  ''
].join('\n');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const formatTestHeadline = (report) => {
  const todoNote = report.todo > 0 ? `, todo: ${report.todo}, of which failing: ${report.todoFailing || 0}` : '';
  const skippedNote = `${report.skipped > 0 ? `, ${report.skipped} skipped` : ''}${todoNote}`;
  if (isPass(report.status)) {
    const isEmptyAllowed = report.passed === 0;
    if (isEmptyAllowed) return `${ANSI.DIM}-${ANSI.RESET} ${ANSI.BOLD}No tests ran (allowed by --allow-empty)${ANSI.RESET}`;
    return `${ANSI.LIME}✔${ANSI.RESET} ${ANSI.BOLD}All tests passed${ANSI.RESET} ${ANSI.DIM}(${report.passed} passed${skippedNote} in ${report.durationMs}ms)${ANSI.RESET}`;
  }
  if (isInconclusive(report.status)) {
    const why = report.executionError || report.detail || report.reason;
    return `${ANSI.YELLOW}?${ANSI.RESET} ${ANSI.BOLD}Inconclusive: ${report.reason}${ANSI.RESET} ${ANSI.DIM}(${why})${ANSI.RESET}`;
  }
  const isUsageError = report.reason === 'USAGE';
  if (isUsageError) return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Usage error:${ANSI.RESET} ${report.executionError}`;
  const hasOnlyExecutionError = report.executionError && report.failures.length === 0;
  if (hasOnlyExecutionError) {
    return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test command failed (exit ${report.exitCode}):${ANSI.RESET} ${report.executionError}`;
  }
  const didNotStart = report.failures.some((f) => f.kind === 'startup-error') && report.failed === 0;
  if (didNotStart) return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test runner failed to start:${ANSI.RESET} ${report.executionError}`;
  const errorNote = report.errors > 0 ? `, ${plural(report.errors, 'unhandled error')}` : '';
  return `${ANSI.RED}✖${ANSI.RESET} ${ANSI.BOLD}Test Failures (${report.failed} failed${errorNote} out of ${report.totalTests}${todoNote})${ANSI.RESET}`;
};

// One line naming what --changed / --related selected, or why the whole suite ran.
export const describeSelection = (selection) => {
  if (!selection) return null;
  const isFullSuite = selection.mode === 'full';
  if (isFullSuite) return `Full suite: ${selection.reason}`;
  const changedCount = (selection.changed || []).length;
  const graph = selection.graph ? `, ${selection.graph} graph${selection.graphNote ? ` (${selection.graphNote})` : ''}` : '';
  const unpinned = selection.specs.filter((s) => s.reasons.every((r) => r.startsWith('may load any changed file'))).length;
  const unpinnedNote = unpinned > 0 ? `, ${unpinned} only because they load modules the graph cannot pin` : '';
  const beyondCount = (selection.beyondDepth || []).length;
  const hasDepth = selection.depth !== undefined;
  const depthNote = hasDepth ? `; --depth=${selection.depth}: ${beyondCount} deeper spec(s) NOT run, so this is not proof (rerun without --depth before merging)` : '';
  const deferredCount = (selection.deferred || []).length;
  const deferredNote = deferredCount > 0 ? `; ${deferredCount} affected slow-lane spec(s) NOT run (add --all or use --slow)` : '';
  const metaCount = (selection.meta || []).length;
  const metaNote = metaCount > 0 ? `; ${metaCount} meta spec(s) always run` : '';
  return `Affected specs: ${selection.specs.length} of ${selection.suiteSize ?? '?'} for ${changedCount} changed file(s)${graph}${unpinnedNote}${metaNote}${depthNote}${deferredNote}`;
};

const WIDENING_LABELS = { 'computed-import': 'computed import without open-ok', 'unresolved-import': 'unresolved import without open-ok' };
const WIDENING_FIX = 'fix: declare a real entry point with "// chemx: open-ok" in its first 30 lines or an openImports rule in test-lanes.json (docs/test-lanes.md)';

// One line per file that widened a --changed run (an open file not declared open-ok), then how to fix it.
export const describeWidenings = (selection) => {
  const widened = selection?.widened || [];
  const hasWidenings = widened.length > 0;
  if (!hasWidenings) return [];
  const lines = widened.map((entry) => `widened by ${entry.file} (${WIDENING_LABELS[entry.kind] || entry.kind}): +${plural(entry.specs, 'spec')}`);
  return [...lines, WIDENING_FIX];
};

// One line when specs that need ripgrep were skipped because rg is not on PATH.
export const describeRipgrepSkips = (count) => (count > 0 ? `ripgrep is not on PATH: ${plural(count, 'ripgrep-engine spec')} skipped, so the rg search engine went untested here` : null);

// One line when chemx chose the base itself (a clean tree compares with the upstream default branch).
export const describeBase = (selection) => {
  const isDefaulted = Boolean(selection?.baseDefaulted);
  return isDefaulted ? `Base: ${selection.base} (merge base ${selection.mergeBase}); the tree is clean, so --changed compares with it. Pass --base=<rev> to pick another` : null;
};

export const formatTestReport = (report) => {
  const isProfile = Boolean(report.profile);
  if (isProfile) return formatProfile(report.profile, report.top);
  const dimLines = [describeBase(report.selection), describeSelection(report.selection), ...describeWidenings(report.selection)].filter(Boolean);
  const out = dimLines.map((line) => `  ${ANSI.DIM}${line}${ANSI.RESET}`);
  out.push(`  ${formatTestHeadline(report)}`);
  const rgNote = describeRipgrepSkips(report.skippedRipgrep);
  if (rgNote) out.push(`  ${ANSI.DIM}${rgNote}${ANSI.RESET}`);
  const isFailure = report.status === STATUS.FAIL;
  if (isFailure) {
    for (const failure of report.failures.slice(0, 5)) {
      out.push(`    ${ANSI.RED}✖ ${failure.name}${ANSI.RESET}`);
      for (const line of (failure.details || []).slice(0, 6)) out.push(`      ${ANSI.DIM}${line}${ANSI.RESET}`);
    }
    const hiddenCount = report.failures.length - 5;
    const hasHidden = hiddenCount > 0;
    if (hasHidden) out.push(`    ${ANSI.DIM}...and ${hiddenCount} more${ANSI.RESET}`);
  }
  const showsCommand = report.status !== STATUS.PASS;
  if (showsCommand) out.push(`  ${ANSI.DIM}[${report.command}]${ANSI.RESET}`);
  return `${out.join('\n')}\n${sharedRunNote(report)}`;
};
