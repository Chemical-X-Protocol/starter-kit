// `chemx test --changed [--base=<rev>]` and `--related <files...>`: turns a change set into the
// runner targets (the affected specs), or into a full-suite run with the reason stated.
import fs from 'node:fs';
import path from 'node:path';
import { listChangedFiles } from './test-changes.js';
import { buildDependencyGraph } from './test-graph.js';
import { selectAffectedSpecs, SPEC_FILE } from './test-select.js';
import { suiteGlobs } from './test-command.js';

const FIXTURE_DIR = /(?:^|\/)(?:fixtures|__fixtures__)\//;
const toPosix = (p) => p.split(path.sep).join('/');

// The specs a full run executes: the node --test script's globs when there are any, otherwise
// every *.spec / *.test file outside fixture directories.
const suiteOf = (root, graph) => {
  const specs = [...graph.files].filter((file) => SPEC_FILE.test(file));
  const globs = suiteGlobs(root);
  const canMatchGlobs = Boolean(globs) && typeof path.matchesGlob === 'function';
  if (!canMatchGlobs) return new Set(specs.filter((file) => !FIXTURE_DIR.test(file)));
  return new Set(specs.filter((file) => globs.some((glob) => path.matchesGlob(file, glob))));
};

const relatedChanges = (root, files, cwd) => files.map((file) => {
  const rel = toPosix(path.relative(root, path.resolve(cwd, file)));
  return { path: rel, status: fs.existsSync(path.join(root, rel)) ? 'M' : 'D' };
});

const fullRun = (reason, extra = {}) => ({ targets: [], selection: { mode: 'full', reason, specs: [], unaffected: [], ...extra } });

// Returns { targets, selection, emptyDetail? }. targets is [] for a full run; emptyDetail is set
// when nothing changed or no spec is affected (the caller reports that as inconclusive).
export const resolveChangeScope = (root, { changed = false, base = null, related = [], cwd = root, useIndex = true } = {}) => {
  const listing = changed ? listChangedFiles(root, { base }) : { ok: true, base: null, files: [] };
  const isListingFailed = !listing.ok;
  if (isListingFailed) return fullRun(`cannot list changed files: ${listing.error}`);
  const known = new Set(listing.files.map((c) => c.path));
  const changes = [...listing.files, ...relatedChanges(root, related, cwd).filter((c) => !known.has(c.path))];
  const label = changed ? `vs ${listing.base}` : 'in --related';
  const isUnchanged = changes.length === 0;
  if (isUnchanged) {
    const hint = changed && !base ? '; pass --base=<rev> to include committed work' : '';
    return { targets: [], selection: { mode: 'affected', reason: null, base: listing.base, changed: [], specs: [], unaffected: [] }, emptyDetail: `no changed files ${label}${hint}` };
  }
  const graph = buildDependencyGraph(root, { useIndex });
  const suite = suiteOf(root, graph);
  const result = selectAffectedSpecs({ changes, graph, suite });
  const selection = {
    ...result, base: listing.base, graph: graph.source, ...(graph.note ? { graphNote: graph.note } : {}),
    changed: changes.map((c) => c.path), suiteSize: suite.size
  };
  const targets = result.mode === 'full' ? [] : result.specs.map((spec) => spec.path);
  const isEmpty = result.mode === 'affected' && targets.length === 0;
  const emptyDetail = isEmpty ? `no spec in the suite is affected by ${changes.length} changed file(s) ${label}` : undefined;
  return { targets, selection, ...(emptyDetail ? { emptyDetail } : {}) };
};
