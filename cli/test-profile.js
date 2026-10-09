// `chemx test --profile`: wall time per spec file, slowest first.
// Method (stated in every report): each spec file runs as its own `node --test` process, with
// `workers` of them at a time inside the shared worker budget (test-slots.js). A file's time is
// that process's wall clock, so it includes node startup and grows when the machine is busy.
// It is not CPU time and not the time the file takes inside one combined run.
import { executeBuild } from './build/executor.js';
import { acquireTestSlots, resolveTestBudget, SLOT_OWNER_ENV } from './test-slots.js';
import { shellQuote } from './test-paths.js';

export const PROFILE_METHOD = 'wall clock of each spec file run as its own `node --test` process, run in parallel inside the worker budget';
const DEFAULT_TOP = 25;

const readCount = (stdout, name) => Number(stdout.match(new RegExp(`^# ${name} (\\d+)`, 'm'))?.[1] ?? 0);

const profileOne = async (spec, cwd, timeoutMs) => {
  const command = `node --test --test-reporter=tap ${shellQuote(spec)}`;
  const run = await executeBuild(command, cwd, { isolateTestEnv: true, timeoutMs, env: { [SLOT_OWNER_ENV]: String(process.pid) } });
  const failed = readCount(run.stdout, 'fail') + readCount(run.stdout, 'cancelled');
  const isOk = run.exitCode === 0 && !run.timedOut;
  return { spec, ms: run.durationMs, tests: readCount(run.stdout, 'tests'), failed, ok: isOk, timedOut: Boolean(run.timedOut) };
};

// Runs the pool. specs: root-relative paths. Resolves to the profile (see formatProfile).
export const profileSpecs = async (specs, cwd, options = {}) => {
  const env = options.env || process.env;
  const budget = resolveTestBudget(env);
  const grant = await acquireTestSlots({ env, budget, want: Math.min(budget, Math.max(1, specs.length)), dir: options.slotsDir, onWait: options.onWait, signal: options.signal });
  const queue = [...specs];
  const files = [];
  const startedAt = Date.now();
  const worker = async () => {
    for (let spec = queue.shift(); spec; spec = queue.shift()) files.push(await profileOne(spec, cwd, options.timeoutMs));
  };
  try {
    await Promise.all(Array.from({ length: grant.workers }, worker));
  } finally {
    grant.release();
  }
  files.sort((a, b) => b.ms - a.ms);
  const sumMs = files.reduce((total, file) => total + file.ms, 0);
  return {
    method: PROFILE_METHOD, workers: grant.workers, elapsedMs: Date.now() - startedAt, sumMs,
    specCount: files.length, testCount: files.reduce((total, file) => total + file.tests, 0),
    failedSpecs: files.filter((file) => !file.ok).length, files
  };
};

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

// Text report: the method line, the totals, then the slowest `top` files.
export const formatProfile = (profile, top = DEFAULT_TOP) => {
  const head = [
    `  Profile of ${profile.specCount} spec files (${profile.testCount} tests), ${profile.workers} at a time`,
    `  Method: ${profile.method}.`,
    `  Elapsed ${seconds(profile.elapsedMs)}; sum of file times ${seconds(profile.sumMs)}; ${profile.failedSpecs} spec file(s) failed or timed out.`
  ];
  const rows = profile.files.slice(0, top).map((file) => {
    const mark = file.ok ? ' ' : '!';
    return `  ${mark} ${seconds(file.ms).padStart(7)} ${String(file.tests).padStart(4)} tests  ${file.spec}`;
  });
  const hidden = profile.files.length - rows.length;
  const more = hidden > 0 ? [`  ...${hidden} faster file(s) not shown (--top=<n>, or --json for all)`] : [];
  return `${[...head, ...rows, ...more].join('\n')}\n`;
};
