// Shared by the specs of affected-spec selection and test lanes: a throwaway git project (a pure
// `node --test` script, files written and committed), a `touch` that edits one of them, and `run` to
// call `chemx test` in it. The project is removed when the callback ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { runTestAudit } from './test-audit.js';

export const SPEC = (importLine = '', extra = '') => `import test from 'node:test';\n${importLine}\n${extra}\ntest('ok', () => {});\n`;

export const git = (root, ...args) => {
  const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

// files: { 'rel/path': content }. Committed as `base`; with { upstream: 'origin/main' } that ref is
// made to point at the base commit, as a fetch would.
export const withProject = async (files, fn, { upstream = null } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-scope-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.chemx\n');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    const hasUpstream = Boolean(upstream);
    if (hasUpstream) git(root, 'update-ref', `refs/remotes/${upstream}`, 'HEAD');
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

export const touch = (root, rel, text = '\n// changed\n') => fs.appendFileSync(path.join(root, rel), text);
export const run = (root, args) => runTestAudit([...args, '--json'], false, { cwd: root, print: false });
export const selectedPaths = (report) => report.selection.specs.map((spec) => spec.path).sort();
