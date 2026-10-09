/**
 * Lossless MCP config merge and safe write.
 * - unparseable files are refused, never replaced;
 * - files with comments are refused (a rewrite would drop them) with a manual snippet;
 * - other servers and keys are kept; only the chemical-x entry changes;
 * - writes are atomic (temp + rename) and back up the previous file to <file>.bak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from './installer-jsonc.js';

export const SERVER_KEY = 'chemical-x';

const refuse = (reason) => ({ ok: false, reason });

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const manualSnippet = (serversKey, entry) => JSON.stringify({ [serversKey]: { [SERVER_KEY]: entry } }, null, 2);

/**
 * Plans the merged file content. Returns { ok: true, content } or { ok: false, reason }.
 * options.serversKey: 'mcpServers' (Cursor, Antigravity) or 'servers' (VS Code).
 * options.staleKeys: other top-level keys whose chemical-x entry should be removed.
 */
export const planMcpConfigMerge = (existingText = '', entry = {}, options = {}) => {
  const serversKey = options.serversKey || 'mcpServers';
  const isEmpty = !String(existingText || '').trim();
  const [parsed, parseError, meta] = isEmpty ? [{}, null, { hasComments: false }] : parseJsonc(existingText);
  if (parseError) return refuse(`existing file is not valid JSON/JSONC (${parseError.message}); left untouched`);
  if (!isPlainObject(parsed)) return refuse('existing file is not a JSON object; left untouched');
  if (meta.hasComments) {
    return refuse(`existing file has comments that a rewrite would drop; left untouched. Add this entry by hand:\n${manualSnippet(serversKey, entry)}`);
  }
  const hasServersObject = isPlainObject(parsed[serversKey]);
  const hasConflictingServersKey = parsed[serversKey] !== undefined && !hasServersObject;
  if (hasConflictingServersKey) return refuse(`"${serversKey}" is not an object; left untouched`);
  const next = { ...parsed, [serversKey]: { ...(parsed[serversKey] || {}), [SERVER_KEY]: entry } };
  for (const staleKey of options.staleKeys || []) {
    const hasStaleEntry = isPlainObject(next[staleKey]) && SERVER_KEY in next[staleKey];
    if (!hasStaleEntry) continue;
    const { [SERVER_KEY]: _removed, ...rest } = next[staleKey];
    next[staleKey] = rest;
    const isStaleBlockEmpty = Object.keys(rest).length === 0;
    if (isStaleBlockEmpty) delete next[staleKey];
  }
  return { ok: true, content: JSON.stringify(next, null, 2) + '\n' };
};

/** Atomic write with a .bak of the previous content. Returns 'written' | 'unchanged'. */
export const writeFileSafely = (file, content) => {
  const hasExisting = fs.existsSync(file);
  const previous = hasExisting ? fs.readFileSync(file, 'utf-8') : null;
  if (previous === content) return 'unchanged';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (hasExisting) fs.writeFileSync(`${file}.bak`, previous, 'utf-8');
  const tmp = `${file}.chemx-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
  return 'written';
};

/** Plans and writes one MCP config file. Returns { file, status, reason? }. */
export const installServerEntry = (file, entry, options = {}) => {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const plan = planMcpConfigMerge(existing, entry, options);
  if (!plan.ok) return { file, status: 'refused', reason: plan.reason };
  return { file, status: writeFileSafely(file, plan.content) };
};
