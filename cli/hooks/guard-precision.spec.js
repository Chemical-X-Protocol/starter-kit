// Guard precision (#6756, K11): deny only when the chemx call is a strict superset for that exact
// argument shape; nudge with the closest chemx form when it covers part of the shape; allow silently
// when chemx has nothing. The fixtures mirror what thirteen agents hit on 2026-10-25 (epic #1552 on
// the do-it-for-the-xp board). Pure: no repo, no db (the allow-list tests write a temp .chemxrc).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidePreTool, toPreToolOutput } from './claude-pre-tool.js';

const CONTEXT = { cwd: '/repo', root: '/repo', enforceSearch: true, hasChemxCommand: () => true, nudgePromotion: { all: false, ids: [] }, guardAllow: [], plainGit: false };
const decide = (command, context = CONTEXT) => decidePreTool({ tool_name: 'Bash', tool_input: { command } }, context);
const adviceOf = (command, context = CONTEXT) => toPreToolOutput(decide(command, context))?.hookSpecificOutput.additionalContext ?? null;
const withTempDir = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-precision-'));
  try { body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

// Plain forms in the project root: chemx covers the whole shape, so the guard still denies.
const STAYS_DENIED = [
  ['git log -3', /chemx log/],
  ['git log --oneline --graph', /chemx log/],
  ['git diff HEAD~1 -- src/a.ts', /chemx d/],
  ['git diff --stat origin/main HEAD', /chemx d/],
  ['git show HEAD~1', /chemx show HEAD~1/],
  ['git show --stat HEAD', /chemx show HEAD/],
  ['git show abc123:src/a.ts', /chemx read abc123:src\/a\.ts/],
  ['git show -p abc123 -- src/a.ts', /chemx show abc123 --patch -- src\/a\.ts/],
  ['grep -rn foo src', /chemx q -g/],
  ['grep -rn foo', /chemx q -g/],
  ['grep -rn foo $DIR', /chemx q -g/],
  ['grep -n foo src/a.js', /chemx q -g "foo" --dir=src\/a\.js/],
  ['grep -i foo src/a.js', /chemx q -g "foo" --dir=src\/a\.js/],
  ['git grep foo', /chemx q -g "foo"/],
  ['find . -name "*.spec.js"', /chemx f "\.spec\.js"/],
  ['find src -type f -name "*.js"', /chemx f/],
  ['cat src/a.ts', /chemx read src\/a\.ts/],
  ['node --test cli/a.spec.js cli/b.spec.js', /Use: chemx test cli\/a\.spec\.js cli\/b\.spec\.js\./],
  ['git diff | grep foo', /chemx d --full/],
];

for (const [command, expected] of STAYS_DENIED) {
  test(`stays denied: ${command}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, expected);
  });
}

test('a denied node --test names the one-assertion and full-output forms (K1)', () => {
  assert.match(decide('node --test cli/a.spec.js').reason, /chemx test cli\/a\.spec\.js.*-t "<name>".*--raw/);
  assert.match(decide('node --test --test-name-pattern="my case" cli/a.spec.js').reason, /chemx test cli\/a\.spec\.js -t "my case".*--raw/);
});

// Shapes chemx covers only in part: the call runs and the model sees the closest chemx form.
const BECOMES_NUDGE = [
  ['git -C /elsewhere/wt log --oneline -3', /chemx log --root \/elsewhere\/wt --oneline -3/],
  ['git -C ../wt diff --stat', /chemx d --root \.\.\/wt --stat/],
  ['git -C apps/x diff --stat', /chemx d --root apps\/x --stat/],
  ['git -C /elsewhere/wt show HEAD', /chemx show --root \/elsewhere\/wt HEAD/],
  ['git -C /elsewhere/wt show HEAD:src/a.js', /chemx read --root \/elsewhere\/wt HEAD:src\/a\.js/],
  ['git log origin/main..HEAD --oneline', /chemx log -n 50 origin\/main\.\.HEAD --oneline/],
  ['git log -n 30 main...topic', /chemx log -n 30 main\.\.\.topic/],
  ['git show HEAD~1 HEAD~2', /chemx show HEAD~1/],
  ['git show -U5 HEAD', /chemx show HEAD/],
  ['git show HEAD:a.js HEAD:b.js', /chemx read HEAD:a\.js/],
  ['git diff --name-only HEAD~1', /chemx d --name-only HEAD~1/],
  ['git diff --name-status main HEAD -- src', /chemx d --name-status main HEAD -- src/],
  ['grep -c foo src/a.js', /chemx q -g "foo" src\/a\.js/],
  ['grep -oE "foo[a-z]+" src/a.js', /chemx q -g "foo\[a-z\]\+" src\/a\.js -o --unique --regex/],
  ['grep -o foo src/a.js', /chemx q -g "foo" src\/a\.js -o --unique/],
  ['grep -rno foo src', /chemx q -g "foo" src -o --unique/],
  ['git grep -c foo', /chemx q -g "foo"/],
  ['find . -maxdepth 2 -name "*.js"', /chemx f "\.js"/],
  ['find src -type d', /chemx f "src"/],
  ['sleep 300', /chemx wait/],
  ['until chemx team task show 5 | grep -q done; do sleep 5; done', /chemx wait/],
  ['sleep 5; chemx team task show 6745', /chemx wait/],
];

for (const [command, expected] of BECOMES_NUDGE) {
  test(`nudge, not deny: ${command}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'allow', 'the call runs');
    const output = toPreToolOutput(result);
    assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName']);
    assert.match(output.hookSpecificOutput.additionalContext, expected);
  });
}

test('every chemx call a precision nudge prints is itself allowed without advice', () => {
  for (const [command] of BECOMES_NUDGE) {
    const line = adviceOf(command).split('\n').find((candidate) => candidate.startsWith('- `'));
    const suggestion = line.slice(line.indexOf('`: ') + 3).split('  (')[0].trim();
    const result = decide(suggestion);
    assert.equal(result.decision, 'allow', `${command} -> ${suggestion}`);
    assert.equal(toPreToolOutput(result), null, `${command} -> ${suggestion}`);
  }
});

// Nothing in chemx covers the shape, or the call is not a read/search at all: no deny, no advice.
const BECOMES_SILENT = [
  'command -v php', 'command -v vitest', 'which docker', 'type tsc', 'php --version', 'vitest --version', 'npx tsc --version',
  'eslint -v', 'node --version', 'pnpm vitest --version', 'jest --help',
  'git rev-parse HEAD', 'git rev-parse --show-toplevel', 'git -C /elsewhere/wt rev-parse HEAD',
  'git rebase origin/main', 'git push -u origin fix/x', 'git worktree add ../wt -b fix/x origin/main', 'git branch -D fix/x',
  'git fetch origin', 'git checkout -b fix/x', 'git merge --ff-only origin/main', 'git cherry-pick abc123',
  'sleep 5', 'sleep 120', 'sleep 2m', 'sleep 30 && echo done', 'sleep $DELAY',
  'git diff --name-only | grep src', 'files=$(git diff --name-only)', 'git diff --name-only > /tmp/list.txt',
  'for f in $(git diff --name-only HEAD~1); do php -l "$f"; done', 'git diff --name-only | xargs php -l',
  'grep -v foo src/a.js', 'grep -w foo src/a.js', 'grep -L foo src/a.js', 'grep -q foo src/a.js', 'grep -rnv foo src', 'git grep -v foo',
  'tail -f src/app.ts',
  'find . -mtime -1 -name "*.js"', 'find . -size +1M', 'find src -newer package.json', 'find . -empty -type f',
  'grep -rn foo node_modules/pkg', 'grep -rn foo /tmp/x', 'grep -rn foo ../unowned',
];

for (const command of BECOMES_SILENT) {
  test(`silent: ${command}`, () => {
    const result = decide(command);
    assert.equal(result.decision, 'allow');
    assert.equal(toPreToolOutput(result), null);
  });
}

test('a recursive grep outside the project is a nudge when a chemx project owns the path, silent otherwise', () => {
  withTempDir((dir) => {
    const owned = path.join(dir, 'other');
    fs.mkdirSync(path.join(owned, 'src'), { recursive: true });
    fs.writeFileSync(path.join(owned, '.chemxrc'), '{}');
    const nudged = decide(`grep -rn foo ${owned}/src`);
    assert.equal(nudged.decision, 'allow');
    assert.match(adviceOf(`grep -rn foo ${owned}/src`), new RegExp(`chemx q -g "foo" ${owned}/src`));
    const unowned = path.join(dir, 'plain');
    fs.mkdirSync(unowned);
    assert.equal(adviceOf(`grep -rn foo ${unowned}`), null);
  });
});

test('a recursive grep over a repo path and an outside path stays denied', () => {
  assert.equal(decide('grep -rn foo src /elsewhere').decision, 'deny');
});

test('git -C into another repo is a nudge, so a compound command with a worktree add runs whole', () => {
  const result = decide('git worktree add ../wt -b fix/x origin/main && git -C ../wt log --oneline -3');
  assert.equal(result.decision, 'allow');
  assert.deepEqual(result.nudged, ['nudge-git-c']);
});

test('a denied segment is named and the other segments are said not to have run', () => {
  const result = decide('git worktree add ../wt -b fix/x origin/main && git log -3 && pnpm install');
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /`git log -3` must go through chemx\. Use: chemx log/);
  assert.match(result.reason, /did not run/);
  assert.match(result.reason, /`git worktree add \.\.\/wt -b fix\/x origin\/main`/);
  assert.match(result.reason, /`pnpm install`/);
  assert.match(result.reason, /# chemx-bypass: <reason>/);
});

test('the other-segment list skips cd and export, and caps its length', () => {
  const lead = decide('export CHEMX_AGENT_ID=@x; cd /repo && git log -3');
  assert.match(lead.reason, /denied as a whole/);
  assert.doesNotMatch(lead.reason, /`cd \/repo`|`export /);
  const many = decide('echo a; echo b; echo c; echo d; echo e; git log -3');
  assert.match(many.reason, /\+2 more/);
});

test('a single-segment denial keeps the short form', () => {
  const result = decide('git log -3');
  assert.doesNotMatch(result.reason, /did not run|denied as a whole/);
});

test('a bypass comment still allows a precision nudge and reports the rule it overrode', () => {
  const nudged = decide('git -C /elsewhere/wt log -3 # chemx-bypass: need the raw graph');
  assert.deepEqual([nudged.decision, nudged.bypassReason, nudged.rule, nudged.overrode, nudged.additionalContext], ['allow', 'need the raw graph', 'nudge-git-c', true, undefined]);
  const denied = decide('git log -3 # chemx-bypass: raw graph');
  assert.deepEqual([denied.decision, denied.rule, denied.overrode], ['allow', 'raw-git-log', true]);
});

test('guardNudges: block does not turn a precision nudge into a block, unless the rule id is listed', () => {
  const all = { ...CONTEXT, nudgePromotion: { all: true, ids: [] } };
  assert.equal(decide('git -C /elsewhere/wt log -3', all).decision, 'allow');
  assert.equal(decide('git status', all).decision, 'deny');
  const listed = { ...CONTEXT, nudgePromotion: { all: false, ids: ['nudge-git-c'] } };
  assert.equal(decide('git -C /elsewhere/wt log -3', listed).decision, 'deny');
});

test('guard.allow lists command prefixes that run without a bypass comment or advice', () => {
  const allowed = { ...CONTEXT, guardAllow: ['node --test cli/a.spec.js', 'git log', 'git add'] };
  for (const command of ['node --test cli/a.spec.js', 'node --test ./cli/a.spec.js', 'timeout 60 node --test cli/a.spec.js', 'git log -3', 'git add src/a.ts', 'cd /repo && git log --oneline -5']) {
    const result = decide(command, allowed);
    assert.equal(result.decision, 'allow', command);
    assert.equal(toPreToolOutput(result), null, command);
  }
  assert.equal(decide('node --test cli/b.spec.js', allowed).decision, 'deny', 'another spec file is not listed');
  assert.equal(decide('node --test-only cli/a.spec.js', allowed).decision, 'deny', 'prefix words match whole words');
  assert.equal(decide('git diff', allowed).decision, 'deny');
  assert.equal(decide('git commit -m x', allowed).decision, 'allow', 'the nudge still shows for what is not listed');
  assert.match(adviceOf('git commit -m x', allowed), /chemx commit/);
});

test('guard.allow in a .chemxrc applies from the command directory up to the project root; test.runners is an alias', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ guard: { allow: ['node --test cli/a.spec.js'] }, test: { runners: ['pnpm vitest run'] } }));
    fs.mkdirSync(path.join(dir, 'sub'));
    const context = { cwd: path.join(dir, 'sub'), root: dir, enforceSearch: true, hasChemxCommand: () => true };
    assert.equal(toPreToolOutput(decide('node --test cli/a.spec.js', context)), null);
    assert.equal(decide('node --test cli/a.spec.js', context).decision, 'allow');
    assert.equal(decide('pnpm vitest run', context).decision, 'allow', 'test.runners entries are allow-list entries too');
    assert.equal(decide('pnpm vitest', context).decision, 'deny');
    fs.writeFileSync(path.join(dir, '.chemxrc'), '{ not json');
    assert.equal(decide('node --test cli/a.spec.js', context).decision, 'deny', 'an unreadable config lists nothing');
  });
});

test('guard.plainGit drops the git status, add and commit nudges and nothing else', () => {
  const plain = { ...CONTEXT, plainGit: true };
  for (const command of ['git status', 'git add src/a.ts', 'git commit -m x', 'git status && git add -p && git commit -m x']) {
    assert.equal(toPreToolOutput(decide(command, plain)), null, command);
    assert.match(adviceOf(command), /chemx (status|commit)/, `${command} still nudges without plainGit`);
  }
  assert.equal(decide('git diff', plain).decision, 'deny');
  assert.match(adviceOf('git -C /elsewhere/wt log', plain), /chemx log --root/);
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ guard: { plainGit: true } }));
    const context = { cwd: dir, root: dir, enforceSearch: true, hasChemxCommand: () => true };
    assert.equal(toPreToolOutput(decide('git commit -m x', context)), null);
  });
});
