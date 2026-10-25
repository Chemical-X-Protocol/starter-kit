import fs from 'node:fs';
import path from 'node:path';

export const findFileUpward = (fileName, startDir) => {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
};

export const findProjectRoot = (startDir = process.cwd()) => {
  const pkgFile = findFileUpward('package.json', startDir);
  if (pkgFile) return path.dirname(pkgFile);
  const chemxDir = findFileUpward('.chemx', startDir);
  if (chemxDir) return path.dirname(chemxDir);
  return startDir;
};

export const loadLocalPackageJson = (cwd) => {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
};

export const resolvePackageManager = (cwd) => {
  const pkg = loadLocalPackageJson(cwd);
  if (pkg && typeof pkg.packageManager === 'string') {
    const pmField = pkg.packageManager.toLowerCase();
    if (pmField.startsWith('pnpm')) return 'pnpm';
    if (pmField.startsWith('bun')) return 'bun';
    if (pmField.startsWith('yarn')) return 'yarn';
    if (pmField.startsWith('npm')) return 'npm';
  }

  let currentDir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(currentDir, 'bun.lockb')) || fs.existsSync(path.join(currentDir, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(currentDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) return 'npm';

    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return 'npm';
};

export const detectProjectBuildCommand = (customCmd, cwd = process.cwd()) => {
  const hasCustomCommand = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustomCommand) return customCmd.trim();

  const pm = resolvePackageManager(cwd);
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};

  const scriptCandidates = ['build', 'build:prod', 'build:public', 'bundle'];
  for (const scriptName of scriptCandidates) {
    if (scripts[scriptName]) {
      return pm === 'yarn' ? `yarn ${scriptName}` : `${pm} run ${scriptName}`;
    }
  }

  const hasViteConfig = fs.existsSync(path.join(cwd, 'vite.config.js')) ||
    fs.existsSync(path.join(cwd, 'vite.config.ts')) ||
    fs.existsSync(path.join(cwd, 'vite.config.mjs'));
  if (hasViteConfig) return 'npx vite build';

  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  if (hasTsConfig) return 'npx tsc --noEmit';

  return `${pm} run build`;
};

// A repo's own test runner: tests/run-tests.mjs written against a shared harness (the WordPress
// plugins: `import { harness } from '../../xophz-compass/tests/harness/test-framework.mjs'`, then one
// `import './x.test.mjs'` per file, then `harness.run()`). chemx test runs one file of it by writing a
// copy of the runner with the imports swapped (cli/test-project-runner.js).
export const PROJECT_RUNNER_FILE = path.join('tests', 'run-tests.mjs');
const HARNESS_BINDING = /import\s*\{[^}]*\bharness\b[^}]*\}\s*from\s*['"][^'"]+['"]/;
const HARNESS_RUN = /\bharness\.run\s*\(/;
export const TEST_FILE_IMPORT = /^\s*import\s+(['"])(\.{1,2}\/[^'"]+)\1\s*;?\s*$/;

export const isHarnessRunnerSource = (source = '') => {
  const text = String(source);
  const registersTestFiles = text.split('\n').some((line) => TEST_FILE_IMPORT.test(line));
  return HARNESS_BINDING.test(text) && HARNESS_RUN.test(text) && registersTestFiles;
};

// A package.json with a real `test` script of its own (not the npm placeholder, not a wrapper of
// run-tests.mjs) decides the runner itself.
const hasOwnTestScript = (dir) => {
  const script = loadLocalPackageJson(dir)?.scripts?.test;
  const isReal = typeof script === 'string' && script.trim().length > 0 && !/no test specified/.test(script);
  return isReal && !script.includes('run-tests');
};

const isRepoBoundary = (dir) => ['.git', '.chemx', 'package.json'].some((name) => fs.existsSync(path.join(dir, name)));

// Walks up from startDir to the repo boundary (.git, .chemx or package.json) and returns
// { root, file, abs, source } for the first dir whose tests/run-tests.mjs is a harness runner, else null.
export const findProjectRunner = (startDir = process.cwd()) => {
  let dir = path.resolve(startDir);
  while (true) {
    const abs = path.join(dir, PROJECT_RUNNER_FILE);
    const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
    const isRunner = isHarnessRunnerSource(source) && !hasOwnTestScript(dir);
    if (isRunner) return { root: dir, file: PROJECT_RUNNER_FILE, abs, source };
    const parent = path.dirname(dir);
    const isEnd = isRepoBoundary(dir) || parent === dir;
    if (isEnd) return null;
    dir = parent;
  }
};
