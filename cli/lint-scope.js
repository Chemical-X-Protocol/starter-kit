// Where `chemx lint` runs and whether ESLint can run there at all. A directory with no package.json
// (a WordPress plugin dir) or no ESLint config (flat or legacy) has nothing for ESLint to read; lint
// then says so in one line and runs the micro-checks of `chemx check` instead (K12, #6757).
import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, loadLocalPackageJson } from './build/detector.js';
import { workspaceAt } from './workspace-run.js';

export const LINT_FALLBACK = Object.freeze({ NO_PACKAGE_JSON: 'NO_PACKAGE_JSON', NO_ESLINT_CONFIG: 'NO_ESLINT_CONFIG' });

const FLAT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts'];
const LEGACY_CONFIGS = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json'];

const configIn = (dir, names, flat) => {
  const found = names.find((name) => fs.existsSync(path.join(dir, name)));
  return found ? { file: path.join(dir, found), flat } : null;
};

const configAt = (dir) => {
  const named = configIn(dir, FLAT_CONFIGS, true) ?? configIn(dir, LEGACY_CONFIGS, false);
  if (named) return named;
  const hasInlineConfig = Boolean(loadLocalPackageJson(dir)?.eslintConfig);
  return hasInlineConfig ? { file: path.join(dir, 'package.json'), flat: false } : null;
};

/** The ESLint config that applies to `dir`: its own or the nearest ancestor's, as ESLint looks. { file, flat } or null. */
export const findEslintConfig = (dir) => {
  let current = path.resolve(dir);
  while (true) {
    const found = configAt(current);
    if (found) return found;
    const parent = path.dirname(current);
    const isFilesystemRoot = parent === current;
    if (isFilesystemRoot) return null;
    current = parent;
  }
};

/**
 * { root, fallback }: the directory lint runs in and why ESLint cannot (null when it can). A directory
 * below a workspace root that no package owns is its own root: findProjectRoot would resolve it to the
 * monorepo, and a plugin dir would then be linted, or refused, as the whole monorepo. A custom command
 * or a package.json `lint` script is the project's own runner, so it is never replaced.
 */
export const resolveLintScope = (start, { customCmd = null } = {}) => {
  const origin = path.resolve(start);
  const projectRoot = findProjectRoot(origin);
  const isBelowProjectRoot = origin !== path.resolve(projectRoot);
  const isOutsideEveryPackage = isBelowProjectRoot && Boolean(workspaceAt(projectRoot));
  const root = isOutsideEveryPackage ? origin : projectRoot;
  const hasOwnRunner = Boolean(customCmd) || Boolean(loadLocalPackageJson(root)?.scripts?.lint);
  if (hasOwnRunner) return { root, fallback: null };
  const hasPackageJson = fs.existsSync(path.join(root, 'package.json'));
  if (!hasPackageJson) return { root, fallback: LINT_FALLBACK.NO_PACKAGE_JSON };
  return { root, fallback: findEslintConfig(root) ? null : LINT_FALLBACK.NO_ESLINT_CONFIG };
};

/** The one line lint prints when it ran `chemx check` instead of ESLint. */
export const fallbackNote = (root, fileCount, fallback) => {
  const reason = fallback === LINT_FALLBACK.NO_PACKAGE_JSON ? ' (no package.json)' : '';
  const noun = fileCount === 1 ? 'file' : 'files';
  return `no ESLint config in ${root}${reason}; ran chemx check on ${fileCount} ${noun} instead`;
};

/** The paths the caller typed (relative to `start`) as ESLint, running in `root`, must be given them. */
export const relativeLintTargets = (targets, start, root) =>
  targets.map((target) => path.relative(root, path.resolve(start, target)).split(path.sep).join('/') || '.');
