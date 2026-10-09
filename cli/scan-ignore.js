/**
 * Directories the component resolver never walks: the same lists as the search index
 * (search-scan.js), so the two can never disagree. Generated and vendored dirs are skipped
 * at any depth; kit-only and build-output names (blueprints, benchmarks, scratch, build,
 * out, temp) only at the scan root, so a project's own src/components/blueprints/** is
 * source and stays visible to blast radius (review of #1472).
 */
import path from 'node:path';
import { isIgnoredDir } from './search-scan.js';

/** relDir: the directory's path relative to the scan root (cwd). */
export const isIgnoredScanDir = (name, relDir = name) => isIgnoredDir(name, path.dirname(relDir));
