// `chemx hook claude-post-edit`: after a Bash call, flag repo files written outside chemx (see
// out-of-band-edits.js). After Edit/Write/MultiEdit on a repo source file, run the chemx
// check (auditFile) on it and hand the hazards, with x-atoms helper hints, back to the model as
// PostToolUse additionalContext. Clean files and non-source files produce no output at all.

import fs from 'node:fs';
import path from 'node:path';
import { isRepoSourcePath } from './guard-paths.js';
import { scopeViolations } from './post-edit-scope.js';
import { helperHintsFor, loadXatomsCatalog } from './xatoms-hints.js';
import { OUT_OF_BAND_RULE, outOfBandMessage, scanOutOfBand } from './out-of-band-edits.js';
import { logBypassToDb } from './bypass-log.js';
import { resolveHookAgentId } from './native-edit-lock.js';

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

// After MCP chemx or Edit/Write: refresh the seen record so the next Bash call does not blame them.
const refreshRecordAfterWriter = (payload, env) => {
  const isChemxMcp = String(payload?.tool_name ?? '').startsWith('mcp__chemical-x__');
  const isInBandWriter = isChemxMcp || EDIT_TOOLS.has(payload?.tool_name);
  if (!isInBandWriter) return;
  scanOutOfBand({ root: env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), command: '', isInBandTool: true });
};

// After a Bash call: tell the model about repo files written outside chemx and log one bypass.
const runPostBash = async (payload, env, log) => {
  const cwd = payload.cwd || process.cwd();
  const root = env.CLAUDE_PROJECT_DIR || cwd;
  const command = String(payload?.tool_input?.command ?? '');
  const scan = scanOutOfBand({ root, command });
  const hasFindings = scan !== null && scan.changed.length > 0;
  if (!hasFindings) return null;
  const handle = resolveHookAgentId(payload, env);
  const reason = `changed outside chemx: ${scan.changed.slice(0, 5).join(', ')}`;
  await log({ root, handle, reason, rule: OUT_OF_BAND_RULE, command, session: payload?.session_id ?? null });
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: outOfBandMessage(scan.changed) } };
};

export const runPostEdit = async (payload, env = process.env, { log = logBypassToDb } = {}) => {
  const isBash = payload?.tool_name === 'Bash';
  if (isBash) return runPostBash(payload, env, log);
  refreshRecordAfterWriter(payload, env);
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
