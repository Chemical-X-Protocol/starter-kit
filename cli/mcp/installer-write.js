/**
 * Lossless MCP config merge and safe write.
 * - unparseable files are refused, never replaced;
 * - files with comments are refused (a rewrite would drop them) with a manual snippet;
 * - other servers and keys are kept; only the chemical-x entry changes;
 * - writes are atomic (temp + rename), follow symlinks and keep CRLF;
 * - the first time chemx touches a user file it is backed up to a new <file>.bak[.N].
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
  const hadEntry = hasServersObject && SERVER_KEY in parsed[serversKey];
  return { ok: true, content: JSON.stringify(next, null, 2) + '\n', hadEntry };
};

const resolveWriteTarget = (file) => {
  const isExistingLink = fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  return isExistingLink ? fs.realpathSync(file) : file;
};

const matchLineEndings = (previous, content) => {
  const usesCrlf = typeof previous === 'string' && previous.includes('\r\n');
  return usesCrlf ? content.replace(/\r?\n/g, '\r\n') : content;
};

/** First free backup name: <file>.bak, then <file>.bak.1, .bak.2 ... Never an existing file. */
const nextBackupPath = (file) => {
  let candidate = `${file}.bak`;
  for (let n = 1; fs.existsSync(candidate); n++) candidate = `${file}.bak.${n}`;
  return candidate;
};

/**
 * Atomic write. Follows symlinks to their target and keeps CRLF line endings.
 * options.backup (default true): copy the previous content to a new backup file first.
 * options.isOwnContent(previous): true when the previous content is chemx output; no backup then.
 * Returns { status: 'written' | 'unchanged', backupPath }.
 */
export const writeFileSafely = (file, content, options = {}) => {
  const target = resolveWriteTarget(file);
  const hasExisting = fs.existsSync(target);
  const previous = hasExisting ? fs.readFileSync(target, 'utf-8') : null;
  const finalContent = matchLineEndings(previous, content);
  const isUnchanged = previous === finalContent;
  if (isUnchanged) return { status: 'unchanged', backupPath: null };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const isOwnContent = hasExisting && Boolean(options.isOwnContent?.(previous));
  const shouldBackup = hasExisting && options.backup !== false && !isOwnContent;
  const backupPath = shouldBackup ? nextBackupPath(file) : null;
  if (shouldBackup) fs.writeFileSync(backupPath, previous, 'utf-8');
  const tmp = `${target}.chemx-tmp-${process.pid}`;
  fs.writeFileSync(tmp, finalContent, 'utf-8');
  fs.renameSync(tmp, target);
  return { status: 'written', backupPath };
};

/** Plans and writes one MCP config file. Returns { file, status, reason? }. */
export const installServerEntry = (file, entry, options = {}) => {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const plan = planMcpConfigMerge(existing, entry, options);
  if (!plan.ok) return { file, status: 'refused', reason: plan.reason };
  const { status, backupPath } = writeFileSafely(file, plan.content, { backup: !plan.hadEntry });
  return { file, status, backupPath };
};
