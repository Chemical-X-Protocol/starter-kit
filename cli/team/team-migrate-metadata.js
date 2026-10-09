/**
 * Chemical X Protocol: ids stored inside JSON metadata, remapped on a merge (#2581).
 * A spec's metadataRefs map a column ('metadata') to { key: table } (team-migrate-tables.js). A key
 * holding a number is replaced by its new id, or null when the referenced row was dropped or never
 * existed; a key holding an array keeps only the ids that map. Anything else in the JSON (other
 * keys, strings, nested objects) is left as written, and so is text that is not a JSON object.
 */

const parseObject = (text) => {
  try {
    const value = typeof text === 'string' ? JSON.parse(text) : null;
    const isObject = Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    return isObject ? value : null;
  } catch {
    return null; // chemx-allow: best-effort metadata that is not JSON is merged as written
  }
};

const isIdValue = (value) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));

const remapValue = (value, table, mapId) => {
  const isList = Array.isArray(value);
  if (isList) {
    const mapped = value.map((item) => (isIdValue(item) ? mapId(table, item) : item));
    const kept = mapped.filter((item) => item !== null);
    return { value: kept, dangling: mapped.length - kept.length };
  }
  const isId = isIdValue(value);
  if (!isId) return { value, dangling: 0 };
  const mapped = mapId(table, value);
  return { value: mapped, dangling: mapped === null ? 1 : 0 };
};

/**
 * @param {string} text the stored JSON
 * @param {Record<string, string>} refs key -> table
 * @param {(table: string, value: number|string) => number|null} mapId
 * @returns {{ text: string, changed: boolean, dangling: number }}
 */
export const remapMetadataJson = (text, refs, mapId) => {
  const object = parseObject(text);
  const hasObject = Boolean(object);
  if (!hasObject) return { text, changed: false, dangling: 0 };
  let changed = false;
  let dangling = 0;
  for (const [key, table] of Object.entries(refs)) {
    const hasKey = Object.hasOwn(object, key);
    if (!hasKey) continue;
    const before = JSON.stringify(object[key]);
    const remapped = remapValue(object[key], table, mapId);
    object[key] = remapped.value;
    dangling += remapped.dangling;
    changed = changed || JSON.stringify(remapped.value) !== before;
  }
  return { text: changed ? JSON.stringify(object) : text, changed, dangling };
};

/** Every (column, refs) pair of a spec's metadataRefs. */
export const metadataColumns = (spec) => Object.entries(spec.metadataRefs ?? {});

/**
 * Board feed rows written before a keep-ids=source merge renumbered board tasks: their metadata task
 * ids follow the renumber. Ids that were not renumbered stay as written. Returns rows changed.
 */
export const rekeyBoardMetadata = (db, spec, rekey, tasksTable) => {
  let changed = 0;
  for (const [column, refs] of metadataColumns(spec)) {
    const rows = db.prepare(`SELECT id, ${column} AS meta FROM ${spec.table} WHERE ${column} NOT IN ('', '{}')`).all();
    const isRenumbered = (table, value) => table === tasksTable && rekey.has(Number(value));
    const mapId = (table, value) => (isRenumbered(table, value) ? rekey.get(Number(value)) : value);
    for (const row of rows) {
      const result = remapMetadataJson(row.meta, refs, mapId);
      const isUnchanged = !result.changed;
      if (isUnchanged) continue;
      db.prepare(`UPDATE ${spec.table} SET ${column} = ? WHERE id = ?`).run(result.text, row.id);
      changed++;
    }
  }
  return changed;
};
