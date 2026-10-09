// Build the file plan for `chemx install-hooks --host=claude`: one action per file, each carrying
// the before/after text and a status (create, update, unchanged, refused, error). Nothing is written here.

import fs from 'node:fs';
import path from 'node:path';
import { mergeClaudeSettings } from './claude-settings-merge.js';
import { mergeMcpJson } from './mcp-json-merge.js';
import { planGitHookPin, planWorkflowPin } from './install-hooks-pins.js';
import { resolveFileStatus } from './install-hooks-status.js';

const SETTINGS_FILES = { local: path.join('.claude', 'settings.local.json'), project: path.join('.claude', 'settings.json') };

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null);

const parseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const toJsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Shared shape for JSON files: parse (or start empty), merge, and describe the outcome.
const planJsonFile = (file, label, merge) => {
  const before = readText(file);
  const parsed = before === null ? { ok: true, value: {} } : parseJson(before);
  if (!parsed.ok) return { file, label, status: 'error', before, after: null, notes: [`not valid JSON (${parsed.error}); left untouched`] };
  const merged = merge(parsed.value);
  if (!merged.ok) return { file, label, status: 'error', before, after: null, notes: [`${merged.error}; left untouched`] };
  const notes = [...merged.refusals];
  if (merged.previousLaunch) notes.push(`previous launch: ${merged.previousLaunch}`);
  const isRefusedOnly = merged.isUnchanged && merged.refusals.length > 0;
  const status = resolveFileStatus({ isMissing: before === null, isUnchanged: merged.isUnchanged, isRefusedOnly });
  const after = merged.isUnchanged && before !== null ? before : toJsonText(merged.settings ?? merged.config);
  return { file, label, status, before, after, notes, hasRefusals: merged.refusals.length > 0 };
};

export const buildInstallPlan = ({ projectRoot, scope, launcher, options }) => {
  const actions = [];
  const settingsFile = path.join(projectRoot, SETTINGS_FILES[scope]);
  actions.push(planJsonFile(settingsFile, `Claude ${scope} settings`, (value) => mergeClaudeSettings(value, launcher, { statusline: options.statusline })));
  if (options.mcp) actions.push(planJsonFile(path.join(projectRoot, '.mcp.json'), 'MCP launch', (value) => mergeMcpJson(value, launcher)));
  actions.push(planGitHookPin({ projectRoot, launcher, isRequested: options.gitHook }));
  actions.push(planWorkflowPin({ projectRoot, launcher, isRequested: options.ci }));
  return actions.filter(Boolean);
};

export { SETTINGS_FILES };
