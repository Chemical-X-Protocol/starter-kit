// Affected-spec selection for `chemx test --changed` / `--related`. A spec is selected when it
// changed, sits next to a changed source (x.js -> x.spec.js), or depends on a changed file
// through the dependency graph (test-graph.js). A file the graph cannot pin down (computed
// import(name), an unresolvable specifier) may load any changed file, so it and its dependents
// are selected for every change, with that reason. When the graph cannot prove the selection
// (manifests, lockfiles, runner/compiler configs, shared spec support or fixtures, deleted
// modules, directories) the whole suite runs and `reason` says why: never a silent subset.
import path from 'node:path';
import { walkDependents } from './test-graph.js';

export const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const MANIFEST = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|\.npmrc|\.nvmrc|\.node-version)$/;
const CONFIG = /(?:^|\/)(?:tsconfig[^/]*\.json|jsconfig\.json|[^/]+\.config\.[cm]?[jt]s|\.babelrc[^/]*|\.swcrc)$/;
const SPEC_SUPPORT = /(?:^|\/)(?:spec-support|test-support|test-utils|__mocks__|fixtures|__fixtures__)\//;
const SETUP_FILE = /(?:^|\/)(?:setup-?tests?|test-?setup|vitest\.setup|jest\.setup)\.[cm]?[jt]sx?$/;

const unprovableReason = (change, graph) => {
  const file = change.path;
  const isManifest = MANIFEST.test(file);
  if (isManifest) return `${file} changed (dependencies or scripts can affect any spec)`;
  const isRunnerConfig = CONFIG.test(file);
  if (isRunnerConfig) return `${file} changed (runner/compiler config applies to every spec)`;
  const isSharedSupport = SPEC_SUPPORT.test(file) || SETUP_FILE.test(file);
  if (isSharedSupport) return `${file} changed (shared spec support/fixtures)`;
  const isDeletedModule = change.status === 'D' && !SPEC_FILE.test(file) && /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(file);
  if (isDeletedModule) return `${file} was deleted (its importers can no longer be resolved)`;
  const isDirectory = change.status !== 'D' && !graph.files.has(file) && !graph.isFile(file);
  if (isDirectory) return `${file} is not a file (submodule or directory change)`;
  return null;
};

const colocatedSpecs = (file, suite) => {
  const dir = path.posix.dirname(file);
  const stem = path.posix.basename(file).replace(/\.[^.]+$/, '');
  return [...suite].filter((spec) => path.posix.dirname(spec) === dir && path.posix.basename(spec).startsWith(`${stem}.`));
};

// Files that name `file` (by basename) in their text: readers of non-module files.
const readersOf = (file, graph) => {
  const name = path.posix.basename(file);
  return [...graph.texts.entries()].filter(([reader, text]) => reader !== file && text.includes(name)).map(([reader]) => reader);
};

const selectOpenDependents = (graph, select) => {
  for (const [file, why] of graph.open || []) {
    const reason = `may load any changed file: ${file} ${why}`;
    const isOpenSpec = SPEC_FILE.test(file);
    if (isOpenSpec) select(file, reason);
    for (const [dependent, chain] of walkDependents(graph, file)) {
      const isDependentSpec = SPEC_FILE.test(dependent);
      if (isDependentSpec) select(dependent, `${reason}; depends on ${chain}`);
    }
  }
};

// changes: [{ path, status }] root-relative. suite: Set of spec paths the full run would execute.
// Returns { mode: 'affected'|'full', reason, specs: [{ path, reasons }], unaffected: [{ path, reason }] }.
export const selectAffectedSpecs = ({ changes, graph, suite }) => {
  const blockers = changes.map((change) => unprovableReason(change, graph)).filter(Boolean);
  const hasUnreadable = (graph.unreadable || []).length > 0;
  if (hasUnreadable) blockers.push(`graph inconclusive: unreadable ${graph.unreadable.slice(0, 3).join(', ')}`);
  const hasBlockers = blockers.length > 0;
  if (hasBlockers) return { mode: 'full', reason: blockers.join('; '), specs: [], unaffected: [] };

  const reasons = new Map();
  const select = (spec, reason) => {
    const isInSuite = suite.has(spec);
    if (!isInSuite) return false;
    const isFirstReason = !reasons.has(spec);
    if (isFirstReason) reasons.set(spec, []);
    reasons.get(spec).push(reason);
    return true;
  };
  const unaffected = [];
  for (const change of changes) {
    const file = change.path;
    const isDeleted = change.status === 'D';
    if (isDeleted) {
      unaffected.push({ path: file, reason: 'deleted spec' });
      continue;
    }
    let hits = 0;
    const wasSelfSelected = Boolean(SPEC_FILE.test(file) && select(file, 'changed'));
    if (wasSelfSelected) hits++;
    for (const spec of colocatedSpecs(file, suite)) {
      const wasColocatedSelected = Boolean(spec !== file && select(spec, `colocated with ${file}`));
      if (wasColocatedSelected) hits++;
    }
    const isModule = graph.files.has(file);
    const seeds = isModule ? [file] : readersOf(file, graph);
    for (const seed of seeds) {
      const via = isModule ? '' : ` (${seed} names ${path.posix.basename(file)})`;
      const wasNamingSpecSelected = Boolean(seed !== file && SPEC_FILE.test(seed) && select(seed, `names ${file}`));
      if (wasNamingSpecSelected) hits++;
      for (const [dependent, chain] of walkDependents(graph, seed)) {
        const wasDependentSelected = Boolean(SPEC_FILE.test(dependent) && select(dependent, `depends on ${chain}${via}`));
        if (wasDependentSelected) hits++;
      }
    }
    const hasNoHits = hits === 0;
    if (hasNoHits) unaffected.push({ path: file, reason: isModule ? 'no spec in the suite depends on it through a resolved import' : 'no module imports or names it' });
  }
  const hasLiveChange = changes.some((change) => change.status !== 'D');
  if (hasLiveChange) selectOpenDependents(graph, select);
  const specs = [...reasons.entries()].map(([spec, list]) => ({ path: spec, reasons: list })).sort((a, b) => a.path.localeCompare(b.path));
  return { mode: 'affected', reason: null, specs, unaffected };
};
