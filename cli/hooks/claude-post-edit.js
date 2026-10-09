// `chemx hook claude-post-edit`: after Edit/Write/MultiEdit on a repo source file, run the chemx
// check (auditFile) on it and hand the hazards, with x-atoms helper hints, back to the model as
// PostToolUse additionalContext. Clean files and non-source files produce no output at all.

import fs from 'node:fs';
import path from 'node:path';
import { isRepoSourcePath } from './guard-paths.js';
import { scopeViolations } from './post-edit-scope.js';
import { helperHintsFor, loadXatomsCatalog } from './xatoms-hints.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_HAZARDS = 8;
const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const editedFile = (payload) => payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path ?? null;

export const formatHazards = ({ relativePath, scope, violations, catalog }) => {
  const sorted = [...violations].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const lines = [`chemx check ${relativePath} (${scope}): ${violations.length} hazard${violations.length === 1 ? '' : 's'}`];
  for (const violation of sorted.slice(0, MAX_HAZARDS)) {
    lines.push(`- L${violation.line ?? '?'} ${violation.rule} [${violation.severity}]: ${violation.hazard}`);
    const hints = helperHintsFor(catalog, violation.rule, relativePath);
    const hasHints = hints.length > 0;
    if (hasHints) lines.push(`  x-atoms: ${hints.slice(0, 2).join(' | ')}`);
  }
  const hiddenCount = sorted.length - MAX_HAZARDS;
  const hasHiddenHazards = hiddenCount > 0;
  if (hasHiddenHazards) lines.push(`- ...${hiddenCount} more: chemx check ${relativePath}`);
  return lines.join('\n');
};

export const runPostEdit = async (payload, env = process.env) => {
  const isEditTool = EDIT_TOOLS.has(payload?.tool_name);
  const file = editedFile(payload);
  const hasEditedFile = isEditTool && Boolean(file);
  if (!hasEditedFile) return null;
  const cwd = payload.cwd || process.cwd();
  const root = env.CLAUDE_PROJECT_DIR || cwd;
  const absolute = path.resolve(cwd, file);
  const isAuditable = isRepoSourcePath(absolute, { cwd, root }) && fs.existsSync(absolute);
  if (!isAuditable) return null;
  const relativePath = path.relative(root, absolute);
  const { auditFile } = await import('../audit.js');
  const scoped = scopeViolations(auditFile(absolute, relativePath), { file: absolute, cwd: root, since: env.CHEMX_POST_EDIT_SINCE || null });
  const isClean = scoped.violations.length === 0;
  if (isClean) return null;
  const additionalContext = formatHazards({ relativePath, scope: scoped.scope, violations: scoped.violations, catalog: loadXatomsCatalog(root, env) });
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } };
};
