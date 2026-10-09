// Picks the type checker that actually understands the project's sources.
// Plain `tsc` ignores .vue/.svelte files, so framework projects use vue-tsc / svelte-check,
// always from the local node_modules/.bin (never `npx`, which can fetch an unrelated package).
// A missing checker is reported as inconclusive and named, never as a clean result.
import fs from 'node:fs';
import path from 'node:path';
import { resolvePackageManager, loadLocalPackageJson } from './build/detector.js';
import { STATUS } from './result-status.js';
import { readTsconfig, isSolutionStyle } from './tsconfig-shape.js';

export const TYPECHECK_REASONS = Object.freeze({
  CHECKER_MISSING: 'CHECKER_MISSING',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  SOLUTION_TSCONFIG: 'SOLUTION_TSCONFIG'
});

const solutionStylePlan = (checker) => ({
  command: null,
  checker,
  status: STATUS.INCONCLUSIVE,
  reason: TYPECHECK_REASONS.SOLUTION_TSCONFIG,
  message: `tsconfig.json only references other configs, so \`${checker} --noEmit\` would check no files; add a "typecheck" script (for example "${checker} --build --force")`
});

const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types', 'tsc'];

export const findLocalBin = (cwd, name) => {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const toRunnable = (cwd, binPath) => {
  const relative = path.relative(cwd, binPath);
  const isInsideCwd = !relative.startsWith('..');
  return isInsideCwd ? relative : binPath;
};

const checkerPlan = (cwd, binName, args, label) => {
  const bin = findLocalBin(cwd, binName);
  if (bin) return { command: `${toRunnable(cwd, bin)} ${args}`.trim(), checker: binName };
  return {
    command: null,
    checker: binName,
    status: STATUS.INCONCLUSIVE,
    reason: TYPECHECK_REASONS.CHECKER_MISSING,
    message: `${label} project but ${binName} is not installed (no node_modules/.bin/${binName}); install it or add a "typecheck" script`
  };
};

// Returns { command, checker, status?, reason?, message? }. status is only set when the
// checker cannot run; otherwise the caller runs `command` and judges its output.
export const planTypecheck = (customCmd, cwd = process.cwd()) => {
  const hasCustom = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustom) return { command: customCmd.trim(), checker: 'custom' };

  const pkg = loadLocalPackageJson(cwd);
  const scripts = pkg?.scripts || {};
  const pm = resolvePackageManager(cwd);
  const scriptName = TYPECHECK_SCRIPTS.find((name) => scripts[name]);
  if (scriptName) return { command: `${pm} run ${scriptName}`, checker: `script:${scriptName}` };

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const hasTsconfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  const isSvelte = Boolean(deps.svelte || deps['svelte-check'] || deps['@sveltejs/kit']);
  const isVue = Boolean(deps.vue || deps.nuxt || deps['vue-tsc']);

  if (isSvelte) return checkerPlan(cwd, 'svelte-check', '', 'Svelte');
  const hasSolutionTsconfig = hasTsconfig && isSolutionStyle(readTsconfig(cwd));
  if (hasSolutionTsconfig) return solutionStylePlan(isVue ? 'vue-tsc' : 'tsc');
  if (isVue && (hasTsconfig || deps['vue-tsc'])) return checkerPlan(cwd, 'vue-tsc', '--noEmit', 'Vue');
  if (hasTsconfig) return checkerPlan(cwd, 'tsc', '--noEmit', 'TypeScript');

  return {
    command: null,
    checker: null,
    status: STATUS.INCONCLUSIVE,
    reason: TYPECHECK_REASONS.NOT_APPLICABLE,
    message: 'No typecheck script and no tsconfig.json: nothing to typecheck'
  };
};

export const detectTypecheckCommand = (customCmd, cwd = process.cwd()) => {
  const plan = planTypecheck(customCmd, cwd);
  return plan.command;
};
