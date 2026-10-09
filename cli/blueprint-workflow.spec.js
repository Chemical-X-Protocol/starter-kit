import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKFLOW_PATH = fileURLToPath(new URL('../blueprints/workflows/chemx-audit.yml', import.meta.url));
const WORKFLOW_TEXT = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const WORKFLOW_LINES = WORKFLOW_TEXT.split('\n');
const AUDIT_STEP = 'Run Chemical X Architectural Audit';
const COMMENT_STEP = 'Post Architectural Audit Comment on PR';

const indentOf = (line) => line.length - line.trimStart().length;

const listJobIds = (lines) => {
  const start = lines.indexOf('jobs:');
  const ids = [];
  for (const line of lines.slice(start + 1)) {
    const isTopLevelKey = /^\S/.test(line);
    if (isTopLevelKey) break;
    const jobMatch = line.match(/^ {2}([\w-]+):\s*$/);
    if (jobMatch) ids.push(jobMatch[1]);
  }
  return ids;
};

// Reads a step's `run: |` literal block the way YAML does: every deeper-indented line, dedented.
const extractRunBlock = (lines, stepName) => {
  const stepIndex = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.ok(stepIndex !== -1, `step "${stepName}" not found`);
  const runIndex = lines.findIndex((line, i) => i > stepIndex && /^\s*run: \|\s*$/.test(line));
  const runIndent = indentOf(lines[runIndex]);
  const body = [];
  for (const line of lines.slice(runIndex + 1)) {
    const isBlank = line.trim() === '';
    const isInsideBlock = isBlank || indentOf(line) > runIndent;
    if (!isInsideBlock) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const blockIndent = Math.min(...body.filter((line) => line.trim() !== '').map(indentOf));
  return `${body.map((line) => line.slice(blockIndent)).join('\n')}\n`;
};

const makeTmpDir = (t, label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chemx-blueprint-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const writeStub = (dir, name, body) => {
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

// Developer CHEMX_* variables would otherwise leak floors into the step under test.
const buildStepEnv = (stubDir, extra) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const isChemxKey = key.startsWith('CHEMX_');
    if (!isChemxKey) env[key] = value;
  }
  return { ...env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}`, ...extra };
};

const runStep = (script, cwd, env) => {
  const result = spawnSync('/bin/sh', ['-e', '-c', script], { cwd, env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `step failed: ${result.stderr}`);
  return result;
};

test('blueprint CI: ships only the molecular-audit job (the kit-only scaffold smoke test is gone)', () => {
  assert.deepStrictEqual(listJobIds(WORKFLOW_LINES), ['molecular-audit']);
  assert.ok(!WORKFLOW_TEXT.includes('cli/create.js'), 'user projects have no cli/create.js');
  assert.ok(!WORKFLOW_TEXT.includes('node cli/index.js'), 'user projects run chemx through npx');
});

test('blueprint CI: no hardcoded grade or score floors, and no JS-template escapes', () => {
  assert.ok(!WORKFLOW_TEXT.includes("|| 'B'"), 'grade floor must come only from vars.CHEMX_MIN_GRADE');
  assert.ok(!WORKFLOW_TEXT.includes('|| 80'), 'score floor must come only from vars.CHEMX_MIN_SCORE');
  assert.ok(!WORKFLOW_TEXT.includes('\\$'), 'a backslash before $ reaches the shell as a literal ${VAR}');
  assert.ok(!WORKFLOW_TEXT.includes('\t'), 'YAML indentation cannot use tabs');
});

test('blueprint CI: the audit step reads the floors from env and never interpolates vars into the script', () => {
  assert.ok(WORKFLOW_TEXT.includes('          CHEMX_MIN_GRADE: ${{ vars.CHEMX_MIN_GRADE }}\n'));
  assert.ok(WORKFLOW_TEXT.includes('          CHEMX_MIN_SCORE: ${{ vars.CHEMX_MIN_SCORE }}\n'));
  const script = extractRunBlock(WORKFLOW_LINES, AUDIT_STEP);
  assert.ok(!script.includes('${{'), `expressions belong in env, not the script:\n${script}`);
  assert.ok(script.includes('npx --yes chemx audit "$@"'), script);
});

const FLOOR_CASES = [
  { label: 'no repo variables', vars: {}, floors: [] },
  { label: 'grade only', vars: { CHEMX_MIN_GRADE: 'A' }, floors: ['--min-grade=A'] },
  { label: 'score only', vars: { CHEMX_MIN_SCORE: '90' }, floors: ['--min-score=90'] },
  { label: 'both', vars: { CHEMX_MIN_GRADE: 'A', CHEMX_MIN_SCORE: '90' }, floors: ['--min-grade=A', '--min-score=90'] },
  { label: 'a value with shell syntax', vars: { CHEMX_MIN_GRADE: 'B; echo pwned' }, floors: ['--min-grade=B; echo pwned'] }
];

for (const { label, vars, floors } of FLOOR_CASES) {
  test(`blueprint CI: audit floors with ${label}`, (t) => {
    const stubDir = makeTmpDir(t, 'npx');
    writeStub(stubDir, 'npx', 'for arg in "$@"; do printf "%s\\n" "$arg"; done');
    // Actions sets an unset repo variable to the empty string, so both names are always present.
    const env = buildStepEnv(stubDir, { CHEMX_MIN_GRADE: '', CHEMX_MIN_SCORE: '', ...vars });

    const result = runStep(extractRunBlock(WORKFLOW_LINES, AUDIT_STEP), stubDir, env);

    const npxArgs = result.stdout.split('\n').filter(Boolean);
    assert.deepStrictEqual(npxArgs, ['--yes', 'chemx', 'audit', '--markdown', '--output=AUDIT_REPORT.md', ...floors]);
  });
}

const runCommentStep = (t, { existingCommentId = '' } = {}) => {
  const workDir = makeTmpDir(t, 'comment');
  const stubDir = makeTmpDir(t, 'gh');
  const ghLog = path.join(stubDir, 'gh.log');
  writeStub(stubDir, 'gh', 'printf "%s\\n" "$*" >> "$GH_LOG"\nif [ "$1" = "api" ] && [ "$2" != "--method" ]; then printf "%s" "$STUB_COMMENT_ID"; fi');
  fs.writeFileSync(path.join(workDir, 'AUDIT_REPORT.md'), '# Audit\n');
  // Stand in for the Actions runner, which expands ${{ }} expressions before the shell runs.
  const script = extractRunBlock(WORKFLOW_LINES, COMMENT_STEP).replace('${{ vars.CHEMX_DISCUSSION_URL }}', 'https://example.test/d/1');
  const env = buildStepEnv(stubDir, { GH_LOG: ghLog, STUB_COMMENT_ID: existingCommentId, REPO: 'acme/app', PR_NUMBER: '42', GH_TOKEN: 'x' });

  runStep(script, workDir, env);

  return {
    ghCalls: fs.readFileSync(ghLog, 'utf8').split('\n').filter(Boolean),
    comment: fs.readFileSync(path.join(workDir, 'PR_COMMENT.md'), 'utf8')
  };
};

test('blueprint CI: the PR-comment step expands REPO and PR_NUMBER and links the discussion', (t) => {
  const { ghCalls, comment } = runCommentStep(t);

  assert.match(ghCalls[0], /^api repos\/acme\/app\/issues\/42\/comments --jq /);
  assert.strictEqual(ghCalls[1], 'pr comment 42 --body-file PR_COMMENT.md');
  assert.ok(comment.includes('(https://example.test/d/1)'), comment);
  assert.ok(comment.includes('# Audit'), comment);
});

test('blueprint CI: the PR-comment step updates an existing audit comment in place', (t) => {
  const { ghCalls } = runCommentStep(t, { existingCommentId: '777' });

  assert.strictEqual(ghCalls[1], 'api --method PATCH repos/acme/app/issues/comments/777 -F body=@PR_COMMENT.md');
  assert.strictEqual(ghCalls.length, 2);
});

const hasPyYaml = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;

test('blueprint CI: parses as YAML with the same audit step the structural reader sees', { skip: !hasPyYaml && 'python3 with PyYAML not available' }, () => {
  const parsed = spawnSync('python3', ['-c', 'import json, sys, yaml; json.dump(yaml.safe_load(sys.stdin), sys.stdout)'], {
    input: WORKFLOW_TEXT,
    encoding: 'utf8'
  });
  assert.strictEqual(parsed.status, 0, parsed.stderr);
  const workflow = JSON.parse(parsed.stdout);

  assert.deepStrictEqual(Object.keys(workflow.jobs), ['molecular-audit']);
  const auditStep = workflow.jobs['molecular-audit'].steps.find((step) => step.name === AUDIT_STEP);
  assert.deepStrictEqual(auditStep.env, {
    CHEMX_MIN_GRADE: '${{ vars.CHEMX_MIN_GRADE }}',
    CHEMX_MIN_SCORE: '${{ vars.CHEMX_MIN_SCORE }}'
  });
  assert.strictEqual(auditStep.run, extractRunBlock(WORKFLOW_LINES, AUDIT_STEP));
});
