// `chemx install-hooks --native-file-tools=block|warn|allow`: record the native-tool policy in the
// project's chemx config (first existing of .chemxrc, .chemxrc.json, .chemx/config.json; else a new
// .chemxrc). Only strict JSON is rewritten: a config with comments is refused and left untouched.

import fs from 'node:fs';
import path from 'node:path';
import { resolveFileStatus } from './install-hooks-status.js';
import { POLICY_CONFIG_KEY, POLICY_MODES } from './native-tool-policy.js';

const CONFIG_CANDIDATES = ['.chemxrc', '.chemxrc.json', path.join('.chemx', 'config.json')];

const parseStrictJson = (text) => {
  try {
    const value = JSON.parse(text);
    const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    return isObject ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false }; // comments or trailing commas: the caller refuses and leaves the file alone
  }
};

const refused = (file, before, mode) => ({
  file,
  label: 'chemx config',
  status: 'refused',
  before,
  after: before,
  notes: [`not strict JSON; left untouched. Add "${POLICY_CONFIG_KEY}": "${mode}" by hand`],
});

export const isPolicyMode = (mode) => POLICY_MODES.includes(mode);

export const planNativeToolsConfig = ({ projectRoot, mode }) => {
  const isRequested = Boolean(mode);
  if (!isRequested) return null;
  const existing = CONFIG_CANDIDATES.map((relative) => path.join(projectRoot, relative)).find((candidate) => fs.existsSync(candidate));
  const file = existing ?? path.join(projectRoot, CONFIG_CANDIDATES[0]);
  const before = existing ? fs.readFileSync(file, 'utf-8') : null;
  const parsed = before === null ? { ok: true, value: {} } : parseStrictJson(before);
  const isUnreadable = !parsed.ok;
  if (isUnreadable) return refused(file, before, mode);
  const current = parsed.value[POLICY_CONFIG_KEY];
  const isUnchanged = current === mode;
  const after = isUnchanged ? before : `${JSON.stringify({ ...parsed.value, [POLICY_CONFIG_KEY]: mode }, null, 2)}\n`;
  const marker = current === undefined ? '+' : '~';
  const notes = isUnchanged ? [] : [`${marker} ${POLICY_CONFIG_KEY}: ${mode}${current === undefined ? '' : ` (was ${JSON.stringify(current)})`}`];
  return { file, label: 'chemx config', status: resolveFileStatus({ isMissing: before === null, isUnchanged }), before, after, notes };
};
