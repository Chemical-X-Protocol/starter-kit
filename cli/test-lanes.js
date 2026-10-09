// Test lanes: the declared split of the spec suite into a fast default lane and a slow lane.
// The manifest (test-lanes.json at the project root) holds the only membership data:
//   slow:     [{ glob, why }]  specs that spawn the CLI or MCP server, stress/timing/perf specs
//   excluded: [{ glob, why }]  spec-named files the suite script never runs (templates, scratch)
// The suite itself is the project's `test` script (suiteGlobs); the default lane is the suite
// minus the slow lane, so a new spec is in the default lane unless the manifest says otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { suiteGlobs } from './test-command.js';
import { SPEC_FILE } from './test-select.js';

// Rules without a reason are reported (see planLanes.unexplained): membership must say why.
export const LANES_FILE = 'test-lanes.json';
const SKIP_DIRS = new Set(['node_modules', '.git', '.chemx', '.claude']);

const toPosix = (p) => p.split(path.sep).join('/');
const matchesAny = (file, rules) => rules.some((rule) => path.matchesGlob(file, rule.glob));

const walkSpecs = (root, dir = '') => {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    const isWalkable = entry.isDirectory() && !SKIP_DIRS.has(entry.name);
    const isSpec = entry.isFile() && SPEC_FILE.test(entry.name);
    if (isWalkable) found.push(...walkSpecs(root, rel));
    if (isSpec) found.push(rel);
  }
  return found;
};

// A rule is { glob, why, convention? }. A convention rule is a naming pattern that may match
// nothing yet, so it is never reported as stale.
const readRules = (value) => (Array.isArray(value) ? value.filter((rule) => typeof rule?.glob === 'string') : []);

// { slow, excluded } or null when the project declares no lanes. A manifest that is not valid
// JSON is an error the caller reports; lanes never fall back silently.
export const loadLaneManifest = (root) => {
  const file = path.join(root, LANES_FILE);
  const exists = fs.existsSync(file);
  if (!exists) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { slow: readRules(parsed.slow), excluded: readRules(parsed.excluded) };
  } catch (error) {
    return { error: `${LANES_FILE} is not valid JSON: ${error.message}`, slow: [], excluded: [] };
  }
};

// Every spec-named file under root, as posix paths relative to it (skips node_modules, .git, .chemx).
export const listAllSpecs = (root) => walkSpecs(root).map(toPosix).sort();

// The lane plan, or null when lanes do not apply (no manifest, or the test script is not a plain
// `node --test <globs>` list). { suite, fast, slow, excluded, uncollected, staleRules, error? }:
//   uncollected: spec files in neither the suite nor `excluded` (silently dropped otherwise)
//   staleRules:  manifest globs that match no spec file (naming-convention rules excepted)
//   unexplained: manifest globs with no "why"
export const planLanes = (root) => {
  const manifest = loadLaneManifest(root);
  const globs = suiteGlobs(root);
  const applies = Boolean(manifest) && Boolean(globs);
  if (!applies) return null;
  const all = listAllSpecs(root);
  const suite = all.filter((file) => globs.some((glob) => path.matchesGlob(file, glob)));
  const outside = all.filter((file) => !suite.includes(file));
  const slow = suite.filter((file) => matchesAny(file, manifest.slow));
  const fast = suite.filter((file) => !slow.includes(file));
  const excluded = outside.filter((file) => matchesAny(file, manifest.excluded));
  const uncollected = outside.filter((file) => !excluded.includes(file));
  const staleRules = [...manifest.slow, ...manifest.excluded].filter((rule) => !rule.convention).filter((rule) => !all.some((file) => path.matchesGlob(file, rule.glob))).map((rule) => rule.glob);
  const unexplained = [...manifest.slow, ...manifest.excluded].filter((rule) => !String(rule.why || '').trim()).map((rule) => rule.glob);
  return { suite, fast, slow, excluded, uncollected, staleRules, unexplained, ...(manifest.error ? { error: manifest.error } : {}) };
};

const LANE_FLAGS = { all: 'all', slow: 'slow' };

// Which lane a run asks for: 'all' (--all), 'slow' (--slow), otherwise 'fast'.
export const requestedLane = (flags = {}) => {
  const picked = Object.keys(LANE_FLAGS).find((name) => flags[name]);
  return picked || 'fast';
};

// Spec paths of one lane. 'all' returns the whole suite.
export const laneSpecs = (plan, lane) => {
  const byLane = { all: plan.suite, slow: plan.slow, fast: plan.fast };
  return byLane[lane];
};

const isAffectedSelection = (scope) => scope.selection?.mode === 'affected' && scope.targets.length > 0;
const isFullSuiteScope = (scope) => scope.targets.length === 0 && scope.selection?.mode !== 'affected';

// Applies the requested lane to a resolved scope { targets, filter, selection, emptyDetail? }.
// Explicit targets are the caller's choice and never filtered. A full-suite scope becomes the
// lane's spec list (--all keeps the project's own test script). An affected selection is split:
// specs of other lanes are listed in selection.deferred, never dropped silently.
export const applyLane = (root, scope, lane) => {
  const plan = planLanes(root);
  const hasLanes = Boolean(plan) && !plan.error;
  const laneError = plan?.error ? { laneError: plan.error } : {};
  const keepsScript = lane === 'all';
  const widensToLane = hasLanes && isFullSuiteScope(scope) && !keepsScript;
  const splitsSelection = hasLanes && isAffectedSelection(scope);
  if (widensToLane) return { ...scope, targets: laneSpecs(plan, lane) };
  if (!splitsSelection) return { ...scope, ...laneError };
  const { run, deferred } = splitByLane(plan, lane, scope.targets);
  const deferredNote = deferred.length > 0 ? { deferred } : {};
  const selection = { ...scope.selection, ...deferredNote };
  const emptyDetail = run.length === 0 ? `all ${deferred.length} affected spec(s) are outside the ${lane} lane (${deferred.slice(0, 3).join(', ')}); use --all or --slow` : undefined;
  return { ...scope, targets: run, selection, ...(emptyDetail ? { emptyDetail } : {}) };
};

// Splits an affected-spec selection by lane: { run, deferred }. deferred are specs a different
// lane owns, which a --changed run lists instead of running.
export const splitByLane = (plan, lane, specs) => {
  const wanted = new Set(laneSpecs(plan, lane));
  return { run: specs.filter((spec) => wanted.has(spec)), deferred: specs.filter((spec) => !wanted.has(spec)) };
};
