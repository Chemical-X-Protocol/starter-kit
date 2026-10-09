import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTypecheck, TYPECHECK_REASONS } from './typecheck-command.js';
import { runTypecheckAudit } from './typecheck-audit.js';
import { STATUS } from './result-status.js';

const VUE_TSC_FAILING = '#!/bin/sh\necho "src/Comp.vue(2,7): error TS2322: Type \'string\' is not assignable to type \'number\'."\nexit 2\n';

const withProject = async ({ pkg, tsconfig = true, bins = {} }, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-typecheck-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    if (tsconfig) fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    for (const [name, body] of Object.entries(bins)) {
      const binPath = path.join(root, 'node_modules', '.bin', name);
      fs.writeFileSync(binPath, body);
      fs.chmodSync(binPath, 0o755);
    }
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const VUE_PKG = { name: 'vueproj', dependencies: { vue: '^3.4.0' } };

test('typecheck: a Vue project with no script uses the local vue-tsc, never plain tsc', async () => {
  await withProject({ pkg: VUE_PKG, bins: { 'vue-tsc': VUE_TSC_FAILING, tsc: '#!/bin/sh\nexit 0\n' } }, (root) => {
    const plan = planTypecheck(null, root);
    assert.equal(plan.command, path.join('node_modules', '.bin', 'vue-tsc') + ' --noEmit');
    assert.doesNotMatch(plan.command, /npx/);
  });
});

test('typecheck: type errors inside .vue files fail the check (was a false green via tsc)', async () => {
  await withProject({ pkg: VUE_PKG, bins: { 'vue-tsc': VUE_TSC_FAILING, tsc: '#!/bin/sh\nexit 0\n' } }, async (root) => {
    const report = await runTypecheckAudit(['--json'], false, { cwd: root, print: false });
    assert.equal(report.status, STATUS.FAIL);
    assert.equal(report.errorCount, 1);
    assert.equal(report.errors[0].file, 'src/Comp.vue');
  });
});

test('typecheck: a Vue project without vue-tsc installed is inconclusive and names the missing checker', async () => {
  await withProject({ pkg: VUE_PKG, bins: { tsc: '#!/bin/sh\nexit 0\n' } }, async (root) => {
    const report = await runTypecheckAudit(['--json'], false, { cwd: root, print: false });
    assert.equal(report.status, STATUS.INCONCLUSIVE);
    assert.equal(report.reason, TYPECHECK_REASONS.CHECKER_MISSING);
    assert.match(report.executionError, /vue-tsc/);
    assert.equal(report.success, false);
  });
});

test('typecheck: a Svelte project uses svelte-check', async () => {
  await withProject({ pkg: { name: 's', devDependencies: { svelte: '^4' } }, bins: { 'svelte-check': '#!/bin/sh\nexit 0\n' } }, (root) => {
    assert.match(planTypecheck(null, root).command, /svelte-check$/);
  });
});

test('typecheck: a plain TS project uses the local tsc; a project with nothing to check is not applicable', async () => {
  await withProject({ pkg: { name: 'ts' }, bins: { tsc: '#!/bin/sh\nexit 0\n' } }, (root) => {
    assert.equal(planTypecheck(null, root).command, path.join('node_modules', '.bin', 'tsc') + ' --noEmit');
  });
  await withProject({ pkg: { name: 'js' }, tsconfig: false }, (root) => {
    const plan = planTypecheck(null, root);
    assert.equal(plan.command, null);
    assert.equal(plan.reason, TYPECHECK_REASONS.NOT_APPLICABLE);
  });
});

test('typecheck: the project typecheck script still wins over detection', async () => {
  await withProject({ pkg: { ...VUE_PKG, scripts: { 'type-check': 'vue-tsc --noEmit -p tsconfig.app.json' } } }, (root) => {
    assert.match(planTypecheck(null, root).command, /run type-check$/);
  });
});
