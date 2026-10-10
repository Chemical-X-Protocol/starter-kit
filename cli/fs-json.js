import fs from 'node:fs';

/**
 * Reads and parses a JSON file; returns the fallback when the file is missing or not valid JSON.
 * @template T
 * @param {string} file Path of the JSON file.
 * @param {T} fallback Value returned when the file cannot be read or parsed.
 * @returns {unknown | T} The parsed document, or the fallback.
 */
export const readJsonOr = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // A missing or malformed file is an expected state for this reader: the caller supplies the fallback.
    return fallback;
  }
};
