import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPreCommitHookScript } from './installer-templates.js';
import { PROFILES } from './config/profiles.js';

const REPO_SCRIPT = fileURLToPath(new URL('../scripts/pre-commit.sh', import.meta.url));
const HOOK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-template-'));
const TEMPLATE_HOOK = path.join(HOOK_DIR, 'pre-commit');
fs.writeFileSync(TEMPLATE_HOOK, buildPreCommitHookScript(), { mode: 0o755 });

const SCRIPTS = [
  { label: 'installer template hook', path: TEMPLATE_HOOK, text: fs.readFileSync(TEMPLATE_HOOK, 'utf8') },
  { label: 'scripts/pre-commit.sh', path: REPO_SCRIPT, text: fs.readFileSync(REPO_SCRIPT, 'utf8') }
];

// Developer or git-hook variables would leak thresholds, bypasses or a foreign GIT_DIR into the hook.
const buildCleanEnv = (extra = {}) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const isScopedKey = /^(CHEMX_|GIT_)/.test(key);
    if (!isScopedKey) env[key] = value;
  }
  return { ...env, NO_COLOR: '1', ...extra };
};

const runIn = (cwd, command, args, env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr}`);
};

const buildMolecule = (lineCount) => {
  const lines = Array.from({ length: lineCount }, (_, i) => `export const v${i} = ${i};`);
  return `${lines.join('\n')}\n`;
};

// The audit stub keeps stage 2 local (no npx, no network) and always passing.
// staged maps extra source paths to line counts; they are staged next to the molecule.
const createRepo = ({ lines, files = {}, staged = {}, withAuditStub = true }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-repo-'));
  const env = buildCleanEnv();
  runIn(dir, 'git', ['init', '-q'], env);
  const stagedLines = { 'src/molecules/m-x.ts': lines, ...staged };
  const allFiles = { ...files };
  for (const [rel, count] of Object.entries(stagedLines)) allFiles[rel] = buildMolecule(count);
  if (withAuditStub) allFiles['cli/index.js'] = 'process.exit(0);\n';
  for (const [rel, content] of Object.entries(allFiles)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  runIn(dir, 'git', ['add', ...Object.keys(stagedLines)], env);
  return dir;
};

const runHook = (scriptPath, dir, env) => {
  const result = spawnSync('/bin/sh', [scriptPath], { cwd: dir, env, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

// Matches both wordings: "260 LOC > 250 molecule limit" and "260 LOC > 250 LOC molecule capsule limit".
const budgetPattern = (lines, limit) => new RegExp(`${lines} LOC > ${limit}\\b`);

// flaggedLines names the over-budget file's size when it is not the molecule's own.
const assertHookOutcome = (outcome, row) => {
  assert.strictEqual(outcome.status, row.status, outcome.output);
  if (row.budget) assert.match(outcome.output, budgetPattern(row.flaggedLines ?? row.lines, row.budget));
};

const GLOB_CONFIG = '{"profile":"atomic-strict","overrides":[{"files":["src/**/*.spec.ts"]}],"include":"app/**/x"}';
const GLOB_PAIR_CONFIG = '{"include":["src/*"],"profile":"atomic-strict","exclude":["*/dist"]}';
const NESTED_STRICT_CONFIG = '{"profile":"pragmatic","overrides":[{"files":["src/legacy/**"],"profile":"atomic-strict"}]}';

const PROFILE_CASES = [
  { name: 'no config passes a 150-line molecule at the 250 default', lines: 150, status: 0 },
  { name: 'no config blocks a 260-line molecule at 250', lines: 260, status: 1, budget: 250 },
  {
    name: 'atomic-strict .chemxrc with a comment line blocks 150 lines at 100',
    files: { '.chemxrc': '// team profile\n{"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'enforce-file-length under pragmatic blocks 150 lines at 100',
    files: { '.chemxrc': '{"profile":"pragmatic","rules":{"enforce-file-length":true}}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'max-line-count-warning 180 blocks 200 lines at 180',
    files: { '.chemxrc': '{"rules":{"max-line-count-warning":180}}\n' },
    lines: 200,
    status: 1,
    budget: 180
  },
  { name: 'loose profile passes 300 lines at 500', files: { '.chemxrc': '{"profile":"loose"}\n' }, lines: 300, status: 0 },
  {
    name: 'package.json chemx atomic-strict blocks 150 lines at 100',
    files: { 'package.json': '{"name":"consumer","chemx":{"profile":"atomic-strict"}}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'a block-commented atomic-strict setting is ignored, so 150 lines pass',
    files: { '.chemxrc': '/*\n  "profile": "atomic-strict"\n*/\n{"profile":"pragmatic"}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'an invalid .chemxrc is skipped, so .chemxrc.json atomic-strict blocks 150 lines at 100',
    files: { '.chemxrc': '{"profile":"pragmatic",,}\n', '.chemxrc.json': '{"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'legacy .chemx/config.json maxMoleculeLineCount 100 no longer pins the budget',
    files: { '.chemx/config.json': '{"minGrade":"B","minScore":80,"maxLineCount":500,"maxMoleculeLineCount":100}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'max-line-count-warning 800 is capped at the 500-line file budget, so 600 lines are blocked',
    files: { '.chemxrc': '{"rules":{"max-line-count-warning":800}}\n' },
    lines: 600,
    status: 1,
    budget: 500
  },
  {
    name: 'CHEMX_MAX_MOLECULE_LINES=800 is capped at the 500-line file budget, so 600 lines are blocked',
    env: { CHEMX_MAX_MOLECULE_LINES: '800' },
    lines: 600,
    status: 1,
    budget: 500
  },
  {
    name: 'CHEMX_MAX_LINES=200 also caps the 250 molecule default, so 220 lines are blocked',
    env: { CHEMX_MAX_LINES: '200' },
    lines: 220,
    status: 1,
    budget: 200
  },
  {
    name: 'CHEMX_MAX_MOLECULE_LINES=400 wins over the default and passes 300 lines',
    env: { CHEMX_MAX_MOLECULE_LINES: '400' },
    lines: 300,
    status: 0
  },
  ...['abc', '0'].map((value) => ({
    name: `CHEMX_MAX_MOLECULE_LINES=${value} is ignored, so the 250 default blocks 260 lines`,
    env: { CHEMX_MAX_MOLECULE_LINES: value },
    lines: 260,
    status: 1,
    budget: 250
  })),
  {
    name: 'CHEMX_MAX_MOLECULE_LINES=abc falls back to the atomic-strict profile, so 150 lines are blocked at 100',
    env: { CHEMX_MAX_MOLECULE_LINES: 'abc' },
    files: { '.chemxrc': '{"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'CHEMX_MAX_LINES=abc is ignored, so the 500-line file budget blocks a 600-line file',
    env: { CHEMX_MAX_LINES: 'abc' },
    lines: 10,
    staged: { 'src/big.ts': 600 },
    flaggedLines: 600,
    status: 1,
    budget: 500
  },
  {
    name: 'a .chemx/config.json maxLineCount of "abc" is ignored, so a 600-line file is blocked at 500',
    files: { '.chemx/config.json': '{"maxLineCount":"abc"}\n' },
    lines: 10,
    staged: { 'src/big.ts': 600 },
    flaggedLines: 600,
    status: 1,
    budget: 500
  },
  ...['"abc"', '0', '-5'].map((warning) => ({
    name: `loose with max-line-count-warning ${warning} falls back to the loose 500, so 300 lines pass`,
    files: { '.chemxrc': `{"profile":"loose","rules":{"max-line-count-warning":${warning}}}\n` },
    lines: 300,
    status: 0
  })),
  {
    name: 'pragmatic with max-line-count-warning "abc" falls back to 250, so 260 lines are blocked',
    files: { '.chemxrc': '{"rules":{"max-line-count-warning":"abc"}}\n' },
    lines: 260,
    status: 1,
    budget: 250
  },
  {
    name: 'only the top-level profile counts, so a nested atomic-strict in overrides leaves 150 lines passing',
    files: { '.chemxrc': `${NESTED_STRICT_CONFIG}\n` },
    lines: 150,
    status: 0
  },
  {
    name: 'atomic-strict .chemxrc with /* and */ inside glob strings blocks 150 lines at 100',
    files: { '.chemxrc': `${GLOB_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'atomic-strict .chemx/config.json with /* and */ inside glob strings blocks 150 lines at 100',
    files: { '.chemx/config.json': `${GLOB_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'a glob pair around the profile key is not read as a comment, so 150 lines are blocked at 100',
    files: { '.chemxrc': `${GLOB_PAIR_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'an escaped quote before /* keeps the string open, so 150 lines are blocked at 100',
    files: { '.chemxrc': '{"note":"a \\"/*\\" b","profile":"atomic-strict","x":"*/"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'a URL string and a trailing // comment keep atomic-strict, so 150 lines are blocked at 100',
    files: { '.chemxrc': '{"url":"https://x.dev/a//b", // team\n"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  }
];

for (const script of SCRIPTS) {
  for (const row of PROFILE_CASES) {
    test(`${script.label}: ${row.name}`, () => {
      const dir = createRepo(row);
      const outcome = runHook(script.path, dir, buildCleanEnv(row.env));
      fs.rmSync(dir, { recursive: true, force: true });
      assertHookOutcome(outcome, row);
    });
  }
}

const NO_NODE_TOOLS = ['git', 'grep', 'wc', 'tr', 'sed', 'cat'];

const resolveTool = (tool) => {
  const lookup = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  return lookup.stdout.trim();
};

// A PATH holding only these tools makes "command -v node" fail, so the hook takes its grep fallback.
const buildNoNodePath = () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hook-bin-'));
  for (const tool of NO_NODE_TOOLS) {
    fs.symlinkSync(resolveTool(tool), path.join(binDir, tool));
  }
  return binDir;
};

const NO_NODE_CASES = [
  {
    name: 'atomic-strict .chemxrc with a comment line blocks 150 lines at 100',
    files: { '.chemxrc': '// team profile\n{"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  { name: 'no config passes a 150-line molecule at 250', lines: 150, status: 0 },
  {
    name: 'a commented-out atomic-strict line is ignored, so 150 lines pass',
    files: { '.chemxrc': '// {"profile":"atomic-strict"}\n{"profile":"pragmatic"}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'a one-line block comment holding atomic-strict is ignored, so 150 lines pass',
    files: { '.chemxrc': '/* {"profile":"atomic-strict"} */\n{"profile":"pragmatic"}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'a multi-line block comment holding atomic-strict is ignored, so 150 lines pass',
    files: { '.chemxrc': '/*\n  "profile": "atomic-strict"\n*/\n{"profile":"pragmatic"}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'atomic-strict after a block comment on the same line still blocks 150 lines at 100',
    files: { '.chemxrc': '/* team */ {"profile":"atomic-strict"} /* end */\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'enforce-file-length between two block comments still blocks 150 lines at 100',
    files: { '.chemxrc': '{\n/* a */ "rules": {"enforce-file-length": true} /* b\n*/\n}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'atomic-strict .chemxrc with /* and */ inside glob strings blocks 150 lines at 100',
    files: { '.chemxrc': `${GLOB_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'a glob pair around the profile key is not read as a comment, so 150 lines are blocked at 100',
    files: { '.chemxrc': `${GLOB_PAIR_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'an indented block comment line holding atomic-strict is still ignored, so 150 lines pass',
    files: { '.chemxrc': '{\n  /* "profile": "atomic-strict" */\n  "profile": "pragmatic"\n}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'known gap: a nested "profile": "atomic-strict" in an overrides entry also matches, so 150 lines are blocked at 100',
    files: { '.chemxrc': `${NESTED_STRICT_CONFIG}\n` },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'known gap: a block comment that opens mid-line is kept, so the atomic-strict inside it blocks 150 lines at 100',
    files: { '.chemxrc': '{"profile":"pragmatic" /* ,"profile":"atomic-strict" */}\n' },
    lines: 150,
    status: 1,
    budget: 100
  },
  {
    name: 'known gap: an invalid .chemxrc still ends the search, so .chemxrc.json atomic-strict is missed and 150 lines pass',
    files: { '.chemxrc': '{"profile":"pragmatic",,}\n', '.chemxrc.json': '{"profile":"atomic-strict"}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'known gap: package.json "chemx" is not read, so its atomic-strict is missed and 150 lines pass',
    files: { 'package.json': '{"name":"consumer","chemx":{"profile":"atomic-strict"}}\n' },
    lines: 150,
    status: 0
  },
  {
    name: 'known gap: loose is not detected, so 300 lines are blocked at the 250 fallback',
    files: { '.chemxrc': '{"profile":"loose"}\n' },
    lines: 300,
    status: 1,
    budget: 250
  }
];

for (const script of SCRIPTS) {
  for (const row of NO_NODE_CASES) {
    test(`${script.label} without node: ${row.name}`, () => {
      const binDir = buildNoNodePath();
      const dir = createRepo({ ...row, withAuditStub: false });
      const outcome = runHook(script.path, dir, buildCleanEnv({ PATH: binDir }));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
      assertHookOutcome(outcome, row);
    });
  }
}

const PROFILE_BLOCK_PATTERN = /# Molecule budget[\s\S]*?\nMAX_MOLECULE_LINES=[^\n]*\n/;

const extractProfileBlock = (text) => {
  const match = text.match(PROFILE_BLOCK_PATTERN);
  assert.ok(match, 'profile block not found');
  return match[0];
};

test('hook parity: both scripts carry the identical rendered profile block', () => {
  const [template, repoScript] = SCRIPTS.map((script) => extractProfileBlock(script.text));
  assert.strictEqual(template, repoScript);
});

test('hook parity: the profile table matches PROFILES in both scripts', () => {
  const table = Object.entries(PROFILES)
    .map(([name, profile]) => `'${name}': ${profile.maxLineCountWarning}`)
    .join(', ');
  for (const script of SCRIPTS) {
    assert.ok(script.text.includes(`{${table}}`), `${script.label} lacks {${table}}`);
  }
});

test('hook parity: only atomic-strict defaults to enforceFileLength, as the hook JS assumes', () => {
  const enforcing = Object.entries(PROFILES)
    .filter(([, profile]) => profile.enforceFileLength === true)
    .map(([name]) => name);
  assert.deepStrictEqual(enforcing, ['atomic-strict']);
});

test('hook parity: the embedded profile JS has no $, double quotes or backticks', () => {
  for (const script of SCRIPTS) {
    const block = extractProfileBlock(script.text);
    const match = block.match(/node -e "([^"]*)" 2>\/dev\/null\)/);
    assert.ok(match, `${script.label}: node -e body did not close on its own quote`);
    assert.ok(match[1].includes('process.stdout.write'), `${script.label}: node -e body was cut short`);
    assert.doesNotMatch(match[1], /[$`]/);
  }
});

test('hook parity: the profile block runs after the empty STAGED_FILES exit', () => {
  for (const script of SCRIPTS) {
    const stagedExit = script.text.search(/\[ -z "\$STAGED_FILES" \]/);
    const profileStart = script.text.indexOf('PROFILE_MAX_MOL=""');
    assert.ok(stagedExit > 0, `${script.label}: STAGED_FILES exit not found`);
    assert.ok(profileStart > stagedExit, `${script.label}: profile block runs before the STAGED_FILES exit`);
  }
});

test('hook parity: the legacy maxMoleculeLineCount override is gone from both scripts', () => {
  for (const script of SCRIPTS) {
    assert.doesNotMatch(script.text, /CONF_MAX_MOL|maxMoleculeLineCount/, script.label);
  }
});

test.after(() => {
  fs.rmSync(HOOK_DIR, { recursive: true, force: true });
});
