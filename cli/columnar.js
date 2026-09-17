/**
 * Chemical X Protocol: Columnar Serialization Utility
 * Converts object collections into compact single-schema matrices
 * to eliminate repeated dictionary keys and slash token consumption.
 */

/**
 * Transforms an array of objects into a single-schema columnar structure.
 *
 * @param {readonly object[]} items Array of record objects.
 * @param {readonly string[]} cols Column names to extract.
 * @param {Record<string, (item: any) => any>} [accessors={}] Optional field transformers.
 * @returns {{ cols: readonly string[], rows: readonly any[][] }}
 */
export const toColumnar = (items = [], cols = [], accessors = {}) => {
  if (!items || items.length === 0) {
    return { cols, rows: [] };
  }

  const rows = items.map((item) => {
    return cols.map((col) => {
      const accessor = accessors[col];
      if (typeof accessor === 'function') {
        return accessor(item);
      }
      return item[col];
    });
  });

  return { cols, rows };
};

/**
 * Reconstructs an array of objects from a columnar structure.
 *
 * @param {{ cols: readonly string[], rows: readonly any[][] }} columnar
 * @returns {readonly Record<string, any>[]}
 */
export const fromColumnar = (columnar) => {
  if (!columnar || !columnar.cols || !columnar.rows) {
    return [];
  }

  const { cols, rows } = columnar;
  return rows.map((row) => {
    const obj = {};
    cols.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
};
