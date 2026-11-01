/**
 * The language registry (design spec 4.1, 4.2): the shipped records plus any a spec registers
 * through the test seam. Guard-safe: it imports records, the schema and the static table only.
 * Consumers that cache derived state (the languages.js facade) subscribe with onRegistryChange.
 */
import { LANGUAGE_RECORDS } from './records/index.js';
import { assertLanguageRecord } from './schema.js';
import { STATIC_TABLE, buildTable } from './static-table.js';

const testRecords = new Map();
const listeners = new Set();
let current = null;

/** Shipped records with test overrides in place (same id), then new test ids in registration order. */
const compose = () => {
  const isPristine = testRecords.size === 0;
  const shipped = LANGUAGE_RECORDS.map((r) => testRecords.get(r.id) ?? r);
  const shippedIds = new Set(LANGUAGE_RECORDS.map((r) => r.id));
  const added = [...testRecords.values()].filter((r) => !shippedIds.has(r.id));
  const records = Object.freeze([...shipped, ...added]);
  const table = isPristine ? STATIC_TABLE : buildTable(records);
  return { records, table, byId: new Map(records.map((r) => [r.id, r])) };
};

const state = () => {
  current ??= compose();
  return current;
};

const changed = () => {
  current = null;
  listeners.forEach((fn) => fn());
};

/** Every registered record, in registration order. */
export const allLanguages = () => state().records;

/** The record for a language id, or null. */
export const getLanguage = (id) => state().byId.get(id) ?? null;

/** The extension table over the registered records (static-table.js shape). */
export const languageTable = () => state().table;

/** Records claiming an extension (matched lowercase); more than one means the extension is ambiguous. */
export const languagesForExtension = (ext) => {
  const ids = state().table.byExtension.get(ext.toLowerCase()) ?? [];
  return ids.map(getLanguage);
};

/** Calls `fn` after every registry change; returns the unsubscribe function. */
export const onRegistryChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Test seam: registers a schema-valid record for the current process, replacing a shipped record
 * with the same id. Specs call resetTestLanguages() afterwards; nothing else may call this.
 */
export const registerTestLanguage = (record) => {
  assertLanguageRecord(record);
  testRecords.set(record.id, record);
  changed();
  return record;
};

/** Test seam: drops every record registered with registerTestLanguage. */
export const resetTestLanguages = () => {
  const hasTestRecords = testRecords.size > 0;
  if (!hasTestRecords) return;
  testRecords.clear();
  changed();
};
