// Covering specs of heal verify (engine doc, Heal: SAFETY SEQUENCE 6d): the specs that import a touched
// file or the piece module directly or through one more importer (depth 2, the reverse import graph of
// test-graph.js), plus the blueprint's sibling specs, run through `chemx test <files>`.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDependencyGraph } from '../test-graph.js';

const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const CHEMX_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

const importersAt = (graph, seeds, depth) => {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let level = 0; level < depth; level += 1) {
    const next = frontier.flatMap((file) => [...(graph.importers.get(file) ?? [])]).filter((file) => !seen.has(file));
    for (const file of next) seen.add(file);
    frontier = next;
  }
  return seen;
};

/**
 * Specs covering files: { specs (sorted), open (files whose loads the graph cannot pin; reported, not
 * expanded), source }. direct: specs the blueprint already names.
 */
export const coveringSpecs = (root, files, { depth = 2, direct = [] } = {}) => {
  const graph = buildDependencyGraph(root);
  const reached = importersAt(graph, files, depth);
  const specs = new Set([...reached].filter((file) => SPEC_FILE.test(file)));
  for (const spec of direct) specs.add(spec);
  const open = files.filter((file) => graph.open.has(file));
  return { specs: [...specs].sort((a, b) => Number(a > b) - Number(a < b)), open, source: graph.source };
};

// NODE_TEST_CONTEXT marks a process started by a node:test runner; a nested `node --test` that inherits it
// skips its files and passes without running anything, so it is never passed on.
const runEnv = () => {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

const runWith = (root, command, args) => {
  const run = spawnSync(command, args, { cwd: root, encoding: 'utf-8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env: runEnv() });
  return { status: run.status, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim(), stdout: run.stdout ?? '' };
};

const lastJsonLine = (text) => {
  const line = text.trim().split('\n').reverse().find((candidate) => candidate.startsWith('{'));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null; // not chemx test JSON: the run is judged by its exit code alone
  }
};

/**
 * Default runner: `chemx test --json <specs>` from the kit this module belongs to. Returns { ok, output,
 * failures } where failures are the failing test names (null when the output could not be read).
 */
export const chemxTestRunner = (root, specs) => {
  const run = runWith(root, process.execPath, [CHEMX_CLI, 'test', '--json', ...specs]);
  const report = lastJsonLine(run.stdout);
  const failures = Array.isArray(report?.failures) ? report.failures.map((failure) => String(failure.name ?? '')) : null;
  const lines = (report?.failures ?? []).map((failure) => `${failure.name}${failure.message ? `: ${failure.message}` : ''}`);
  return { ok: run.status === 0 && report?.success !== false, output: report ? [`${report.passed ?? 0} passed, ${report.failed ?? 0} failed`, ...lines].join('\n') : run.output, failures };
};

/** Plain `node --test <specs>` (projects without chemx test lanes, and specs of the heal engine itself). */
export const nodeTestRunner = (root, specs) => {
  const run = runWith(root, process.execPath, ['--test', ...specs]);
  const failures = [...run.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
  return { ok: run.status === 0, output: run.output, failures };
};
