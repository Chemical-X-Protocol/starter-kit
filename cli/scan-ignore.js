/**
 * Directories the search index and the component resolver never walk. Kit-only dirs
 * (generator `blueprints/`, `benchmarks/`, `scratch/`) are skipped only at the scan
 * root: a project's own `src/components/blueprints/**` is source and must be indexed
 * (review of #1472: @blueprints consumers were invisible to blast radius).
 */
import path from 'node:path';

const IGNORED_ANYWHERE = new Set([
  'node_modules', 'dist', 'build', 'vendor', '.git',
  '.next', '.turbo', '.output', '.nuxt', '.cache', 'out',
  '.chemx', '.gemini', '.claude', '.cursor', 'temp', 'coverage'
]);
const IGNORED_AT_ROOT = new Set(['blueprints', 'benchmarks', 'scratch']);

/** relDir: the directory's path relative to the scan root (cwd). */
export const isIgnoredScanDir = (name, relDir = name) => {
  const isIgnoredEverywhere = IGNORED_ANYWHERE.has(name);
  const isAtRoot = path.dirname(relDir) === '.';
  return isIgnoredEverywhere || (isAtRoot && IGNORED_AT_ROOT.has(name));
};
