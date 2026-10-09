/**
 * Chemical X UI SQL console guard.
 * The DB Studio console is read-only: one SELECT/WITH/VALUES/EXPLAIN statement
 * or a read-only PRAGMA. Everything else (ATTACH, DDL, DML, PRAGMA writes) is refused.
 * The server also runs console SQL on a readOnly connection as a second wall.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { resolveIndexDbPath } from './search-schema.js';

const READ_STATEMENT_START = /^(SELECT|WITH|VALUES|EXPLAIN|PRAGMA)\b/i;
const WRITE_KEYWORDS = /\b(ATTACH|DETACH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b|\bREPLACE\s+INTO\b/i;
const INTROSPECTION_PRAGMAS = new Set([
  'table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'foreign_key_check', 'integrity_check', 'quick_check'
]);
const QUERY_ONLY_PRAGMAS = new Set([
  ...INTROSPECTION_PRAGMAS, 'table_list', 'database_list', 'collation_list', 'function_list',
  'pragma_list', 'compile_options', 'page_size', 'page_count', 'freelist_count', 'journal_mode',
  'busy_timeout', 'user_version', 'schema_version', 'application_id', 'encoding', 'auto_vacuum',
  'cache_size', 'synchronous', 'foreign_keys', 'wal_autocheckpoint'
]);
const PRAGMA_SHAPE = /^PRAGMA\s+(?:\w+\.)?(\w+)\s*(\(\s*[\w"'.]+\s*\))?\s*$/i;

export const CONSOLE_READ_ONLY_ERROR =
  'Only SELECT, WITH, VALUES, EXPLAIN or read-only PRAGMA statements are permitted, one per request: the SQL console is read-only.';

const stripLiteralsAndComments = (sql) => sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/'(?:[^']|'')*'/g, "''")
  .replace(/"(?:[^"]|"")*"/g, '""')
  .replace(/`[^`]*`/g, '``')
  .replace(/\[[^\]]*\]/g, '[]');

const isSingleStatement = (code) => {
  const withoutTrailing = code.trim().replace(/;\s*$/, '');
  return !withoutTrailing.includes(';');
};

const isReadOnlyPragma = (code) => {
  const shape = code.trim().replace(/;\s*$/, '').match(PRAGMA_SHAPE);
  if (!shape) return false;
  const name = shape[1].toLowerCase();
  const hasArgument = Boolean(shape[2]);
  if (hasArgument) return INTROSPECTION_PRAGMAS.has(name);
  return QUERY_ONLY_PRAGMAS.has(name);
};

/** Returns { allowed, reason } for a console statement. */
export const classifyConsoleSql = (sql = '') => {
  const code = stripLiteralsAndComments(String(sql)).trim();
  if (!code) return { allowed: false, reason: 'Empty SQL statement' };
  const startsAsRead = READ_STATEMENT_START.test(code);
  const isPragma = /^PRAGMA\b/i.test(code);
  const hasWriteKeyword = WRITE_KEYWORDS.test(code);
  const isAllowed = startsAsRead && isSingleStatement(code) && !hasWriteKeyword && (!isPragma || isReadOnlyPragma(code));
  return isAllowed ? { allowed: true } : { allowed: false, reason: CONSOLE_READ_ONLY_ERROR };
};

const loadDatabaseSync = () => {
  try { return createRequire(import.meta.url)('node:sqlite').DatabaseSync; } catch { return null; }
};

/** Opens a readOnly connection to the project index for the SQL console, or null. */
export const openConsoleDb = (cwd = process.cwd()) => {
  const DatabaseSync = loadDatabaseSync();
  const dbPath = resolveIndexDbPath(cwd);
  const hasIndex = Boolean(DatabaseSync) && fs.existsSync(dbPath);
  if (!hasIndex) return null;
  try { return new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
};
