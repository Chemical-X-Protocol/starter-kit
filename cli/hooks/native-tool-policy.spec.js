import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideNativeTool, nativeToolTarget, resolveNativeToolMode, DEFAULT_POLICY_MODE } from './native-tool-policy.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempRoot = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-native-policy-')); created.push(dir); return dir; };

const ROOT = '/repo';
const decide = (tool, input, mode, cwd = ROOT) => decideNativeTool({ tool, input, root: ROOT, cwd, mode });

const IN_ROOT = {
  Read: { file_path: '/repo/src/a.ts' },
  Edit: { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' },
  MultiEdit: { file_path: '/repo/src/a.ts', edits: [] },
  Write: { file_path: '/repo/src/new.ts', content: '' },
  NotebookEdit: { notebook_path: '/repo/notes/n.ipynb', new_source: '' },
  Grep: { pattern: 'useTheme' },
  Glob: { pattern: 'src/**/*.vue' },
};

const EXPECTED_HINT = {
  Read: /chemx read src\/a\.ts --outline`.*--symbol=<name>`.*chemx read src\/a\.ts:<a>-<b>`/,
  Edit: /chemx patch src\/a\.ts <<'EOF'`.*<<<<<<< SEARCH/,
  MultiEdit: /chemx patch src\/a\.ts <<'EOF'`.*>>>>>>> REPLACE/,
  Write: /chemx write src\/new\.ts - <<'EOF'`.*--overwrite/,
  NotebookEdit: /chemx patch notes\/n\.ipynb <<'EOF'`/,
  Grep: /chemx q -g "useTheme" -l`.*chemx q "<symbol>"`/,
  Glob: /chemx f "src\/\*\*\/\*\.vue"`/,
};

for (const tool of Object.keys(IN_ROOT)) {
  test(`${tool} inside the project: block denies, warn allows with a pointer, allow is silent`, () => {
    const blocked = decide(tool, IN_ROOT[tool], 'block');
    assert.deepEqual([blocked.decision, blocked.rule], ['deny', `native-${tool.toLowerCase()}`]);
    assert.match(blocked.reason, EXPECTED_HINT[tool]);
    const warned = decide(tool, IN_ROOT[tool], 'warn');
    assert.equal(warned.decision, 'allow');
    assert.match(warned.additionalContext, EXPECTED_HINT[tool]);
    const allowed = decide(tool, IN_ROOT[tool], 'allow');
    assert.deepEqual([allowed.decision, allowed.additionalContext], ['allow', undefined]);
  });
}

test('an unknown or missing mode falls back to warn', () => {
  assert.equal(DEFAULT_POLICY_MODE, 'warn');
  for (const mode of [undefined, '', 'nope']) {
    const result = decide('Read', IN_ROOT.Read, mode);
    assert.equal(result.decision, 'allow');
    assert.match(result.additionalContext, /nativeFileTools=warn/);
  }
});

test('outside the root, .claude/, node_modules/ and binary files stay free in block mode', () => {
  const free = [
    ['Read', { file_path: '/tmp/scratch/a.ts' }],
    ['Write', { file_path: '/home/me/.claude/projects/x/memory/MEMORY.md' }],
    ['Edit', { file_path: '/repo/.claude/settings.local.json' }],
    ['Read', { file_path: '/repo/node_modules/vue/index.js' }],
    ['Read', { file_path: '/repo/docs/shot.PNG' }],
    ['Read', { file_path: '/repo/docs/spec.pdf' }],
    ['Read', { file_path: '/repo/fonts/a.woff2' }],
    ['Grep', { pattern: 'x', path: '/tmp' }],
    ['Glob', { pattern: '/tmp/claude/**/*.txt' }],
    ['Glob', { pattern: '**/*.json', path: '/repo/node_modules' }],
  ];
  for (const [tool, input] of free) {
    const result = decide(tool, input, 'block');
    assert.deepEqual([result.decision, result.inScope], ['allow', false], `${tool} ${JSON.stringify(input)}`);
  }
});

test('relative paths resolve against cwd; Grep/Glob with no path mean the cwd', () => {
  assert.equal(decide('Read', { file_path: 'a.ts' }, 'block', '/repo/src').decision, 'deny');
  assert.equal(decide('Read', { file_path: '../../etc/x.ts' }, 'block', '/repo/src').decision, 'allow');
  assert.equal(decide('Grep', { pattern: 'x' }, 'block', '/repo/src').decision, 'deny');
  assert.equal(nativeToolTarget('Grep', { pattern: 'x' }), '');
  assert.equal(nativeToolTarget('Glob', { pattern: '/tmp/a/*/b.js' }), '/tmp/a');
  assert.equal(nativeToolTarget('NotebookEdit', { notebook_path: 'n.ipynb' }), 'n.ipynb');
});

test('a project rooted under .claude/ (a worktree) is still enforced; its own .claude/ stays free', () => {
  const root = '/r/.claude/worktrees/w';
  const decideIn = (input) => decideNativeTool({ tool: 'Read', input, root, cwd: root, mode: 'block' });
  assert.equal(decideIn({ file_path: '/r/.claude/worktrees/w/src/a.js' }).decision, 'deny');
  assert.equal(decideIn({ file_path: '/r/.claude/worktrees/w/.claude/settings.json' }).decision, 'allow');
  assert.equal(decideIn({ file_path: '/r/.claude/worktrees/w/pkg/node_modules/x/i.js' }).decision, 'allow');
});

test('a relative Glob pattern resolves against path or cwd, so leaving the root stays free', () => {
  assert.equal(decide('Glob', { pattern: '../other/**/*.js' }, 'block').decision, 'allow');
  assert.equal(decide('Glob', { pattern: '../../**/*.js', path: '/repo/src' }, 'block').decision, 'allow');
  assert.equal(decide('Glob', { pattern: '**/*.js', path: '/repo/src' }, 'block').decision, 'deny');
  assert.equal(nativeToolTarget('Glob', { pattern: '../other/**/*.js' }), '../other');
  assert.equal(nativeToolTarget('Glob', { pattern: '**/*.js' }), '.');
});

test('non-file tools are not this policy\'s concern', () => {
  assert.deepEqual(decide('Bash', { command: 'ls' }, 'block'), { decision: 'allow', rule: null, inScope: false });
});

test('mode: env beats .chemxrc beats .chemx/config.json beats the default; junk is ignored', () => {
  const root = tempRoot();
  assert.equal(resolveNativeToolMode(root, {}), 'warn');
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.writeFileSync(path.join(root, '.chemx', 'config.json'), JSON.stringify({ nativeFileTools: 'block' }));
  assert.equal(resolveNativeToolMode(root, {}), 'block');
  fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ profile: 'balanced' }));
  assert.equal(resolveNativeToolMode(root, {}), 'block', '.chemxrc without the key falls through to config.json');
  fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ nativeFileTools: 'Allow' }));
  assert.equal(resolveNativeToolMode(root, {}), 'allow');
  assert.equal(resolveNativeToolMode(root, { CHEMX_NATIVE_FILE_TOOLS: 'warn' }), 'warn');
  assert.equal(resolveNativeToolMode(root, { CHEMX_NATIVE_FILE_TOOLS: 'sometimes' }), 'allow');
});
