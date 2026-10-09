// Function-body ends across runs (body-ends.js): a file's set of last-statement spans depends only on its
// content and on the parsing code, so it is stored under sha1(engine hash, content sha1) in
// pattern_body_end_cache. A grouping run that misses the run cache (run-cache.js) then parses only the
// files whose content it has not seen, instead of every file with a returning statement. Each run
// replaces the table with the keys it used, so it never grows past one ledger's files.
import crypto from 'node:crypto';
import { engineHashOf } from './run-cache.js';
import { withIndexTransaction } from '../search-index-write.js';

const SQL = {
  read: 'SELECT content_key, ends FROM pattern_body_end_cache',
  clear: 'DELETE FROM pattern_body_end_cache',
  insert: 'INSERT OR REPLACE INTO pattern_body_end_cache (content_key, ends) VALUES (?, ?)'
};

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

/** { keyOf(content), known } for createBodyEndReader: keys bound to the engine hash and the content. */
export const readBodyEnds = (db) => {
  const engine = engineHashOf();
  const keyOf = (content) => sha1(`${engine}\0${sha1(content)}`);
  try {
    return { keyOf, known: new Map(db.prepare(SQL.read).all().map((row) => [row.content_key, JSON.parse(row.ends)])) };
  } catch {
    return { keyOf, known: new Map() };
  }
};

/** Replaces the stored body ends with the run's decisions (Map key -> span keys). */
export const writeBodyEnds = (db, decisions) => withIndexTransaction(db, () => {
  db.prepare(SQL.clear).run();
  const insert = db.prepare(SQL.insert);
  for (const [key, ends] of decisions) insert.run(key, JSON.stringify(ends));
});
