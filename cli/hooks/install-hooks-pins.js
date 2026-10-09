// GAP-4 pins: the git pre-commit hook and the CI workflow run the same chemx as the MCP launcher.
// An existing chemx hook/workflow is re-pinned; a missing one is only created on request
// (--git-hook / --ci); a foreign pre-commit hook is never replaced.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPreCommitHookScript, buildGitHubWorkflowScript } from '../installer-templates.js';
import { resolveFileStatus } from './install-hooks-status.js';

const CHEMX_MARKER = /Chemical X/;
const WORKFLOW_FILE = path.join('.github', 'workflows', 'chemx-audit.yml');
const AUDIT_INVOCATION = /(run:\s*)(?:npx(?:\s+--yes|\s+-y)?\s+chemx(?:@\S+)?|node\s+\S*cli\/index\.js)(\s+audit\b)/;
const PIN_COMMENT = /^# chemx-pin: .*$/m;

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null);

export const resolveGitHooksPath = (projectRoot) => {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: projectRoot, encoding: 'utf-8' });
  const isRepo = result.status === 0 && result.stdout.trim() !== '';
  return isRepo ? path.resolve(projectRoot, result.stdout.trim()) : null;
};

const readGradeDefaults = (projectRoot) => {
  const config = readText(path.join(projectRoot, '.chemx', 'config.json'));
  try {
    const parsed = config ? JSON.parse(config) : {};
    return { minGrade: parsed.minGrade ?? 'B', minScore: parsed.minScore ?? 80 };
  } catch {
    return { minGrade: 'B', minScore: 80 }; // a malformed config falls back to template defaults
  }
};

export const planGitHookPin = ({ projectRoot, launcher, isRequested }) => {
  const hooksDir = resolveGitHooksPath(projectRoot);
  if (!hooksDir) return isRequested ? { file: path.join(projectRoot, '.git'), label: 'git pre-commit', status: 'error', notes: ['not a git repository'] } : null;
  const file = path.join(hooksDir, 'pre-commit');
  const before = readText(file);
  const isMissing = before === null;
  const isSkipped = isMissing && !isRequested;
  if (isSkipped) return null;
  const isForeign = !isMissing && !CHEMX_MARKER.test(before);
  if (isForeign) return { file, label: 'git pre-commit', status: 'refused', before, after: before, notes: ['existing pre-commit hook is not chemx; left untouched'] };
  const { minGrade, minScore } = readGradeDefaults(projectRoot);
  const after = buildPreCommitHookScript(minGrade, minScore, launcher);
  const status = resolveFileStatus({ isMissing, isUnchanged: before === after });
  return { file, label: 'git pre-commit', status, before, after, mode: 0o755, notes: [`pinned to ${launcher.cliPath}`] };
};

export const planWorkflowPin = ({ projectRoot, launcher, isRequested }) => {
  const file = path.join(projectRoot, WORKFLOW_FILE);
  const before = readText(file);
  const isMissing = before === null;
  if (isMissing) {
    if (!isRequested) return null;
    return { file, label: 'CI workflow', status: 'create', before, after: buildGitHubWorkflowScript('B', 80, launcher), notes: [`runs ${launcher.ciBin}`] };
  }
  const hasInvocation = AUDIT_INVOCATION.test(before);
  if (!hasInvocation) return { file, label: 'CI workflow', status: 'refused', before, after: before, notes: ['no recognizable chemx audit step to pin'] };
  const pinned = before.replace(AUDIT_INVOCATION, `$1${launcher.ciBin}$2`);
  const pinLine = `# chemx-pin: ${launcher.version}`;
  const after = PIN_COMMENT.test(pinned) ? pinned.replace(PIN_COMMENT, pinLine) : `${pinLine}\n${pinned}`;
  const status = resolveFileStatus({ isMissing: false, isUnchanged: before === after });
  return { file, label: 'CI workflow', status, before, after, notes: [`runs ${launcher.ciBin}`] };
};
