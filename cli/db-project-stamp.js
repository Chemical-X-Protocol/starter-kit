/**
 * Chemical X Protocol: Project stamp on the index database (truth spec section 4.6).
 * `.chemx/` is gitignored, so a database usually arrives in another project by a directory
 * copy. The db records the project root and a content fingerprint on creation; opening it
 * from a different project is refused, naming both, instead of serving foreign rows.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ADOPT_ENV = 'CHEMX_DB_ADOPT';
export const PROJECT_MISMATCH_CODE = 'CHEMX_PROJECT_MISMATCH';

const toRealPath = (dir) => (fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir));

const readPackageName = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).name || '';
  } catch { // chemx-allow: best-effort a missing or malformed package.json falls back to the directory name
    return '';
  }
};

// Stable across edits and moves, different between unrelated projects.
export const computeProjectFingerprint = (root) => {
  const identity = readPackageName(root) || path.basename(root);
  return crypto.createHash('sha256').update(`chemx-project:${identity}`).digest('hex').slice(0, 16);
};

const readStamp = (db) => {
  try {
    return db.prepare('SELECT root_path, fingerprint FROM project_stamp WHERE id = 1').get() || null;
  } catch { // chemx-allow: best-effort a db created before stamping has no project_stamp table yet
    return null;
  }
};

const writeStamp = (db, root, fingerprint) => {
  db.exec(`CREATE TABLE IF NOT EXISTS project_stamp (
    id INTEGER PRIMARY KEY CHECK (id = 1), root_path TEXT NOT NULL, fingerprint TEXT NOT NULL, stamped_at INTEGER NOT NULL
  )`);
  db.prepare(`INSERT INTO project_stamp (id, root_path, fingerprint, stamped_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path, fingerprint = excluded.fingerprint, stamped_at = excluded.stamped_at`)
    .run(root, fingerprint, Date.now());
};

// Verdicts: 'stamp' (new or legacy db), 'ok', 'restamp' (same place, or a true move), 'refuse'.
export const evaluateProjectStamp = (stamp, root, fingerprint, options = {}) => {
  const hasStamp = Boolean(stamp);
  if (!hasStamp) return { action: 'stamp', reason: 'unstamped' };
  const isSameRoot = stamp.root_path === root;
  if (isSameRoot) {
    const isSameContent = stamp.fingerprint === fingerprint;
    return isSameContent ? { action: 'ok', reason: 'match' } : { action: 'restamp', reason: 'content_changed' };
  }
  const isAdopted = options.adopt === true;
  if (isAdopted) return { action: 'restamp', reason: 'adopted' };
  const pathExists = options.pathExists || fs.existsSync;
  const isOriginalStillThere = pathExists(path.join(stamp.root_path, '.chemx', 'index.db'));
  const isMove = !isOriginalStillThere && stamp.fingerprint === fingerprint;
  if (isMove) return { action: 'restamp', reason: 'moved' };
  return { action: 'refuse', reason: isOriginalStillThere ? 'copied' : 'different_project' };
};

const buildMismatchError = (dbPath, stamp, root, fingerprint) => {
  const err = new Error(
    `Refusing to open ${dbPath}: it belongs to project ${stamp.root_path} (fingerprint ${stamp.fingerprint}), ` +
    `not ${root} (fingerprint ${fingerprint}). The .chemx directory was probably copied from that project, and ` +
    `its tasks, locks and index rows do not describe this one. To start fresh, delete ${dbPath} and its -wal/-shm files; ` +
    `to adopt it for this project, rerun with ${ADOPT_ENV}=1.`
  );
  err.code = PROJECT_MISMATCH_CODE;
  err.isRefusal = true;
  err.stampedRoot = stamp.root_path;
  err.currentRoot = root;
  return err;
};

export const applyProjectStamp = (db, dbPath, options = {}) => {
  const env = options.env || process.env;
  const root = toRealPath(path.dirname(path.dirname(path.resolve(dbPath))));
  const fingerprint = computeProjectFingerprint(root);
  const stamp = readStamp(db);
  const verdict = evaluateProjectStamp(stamp, root, fingerprint, { adopt: env[ADOPT_ENV] === '1' });
  const isRefused = verdict.action === 'refuse';
  if (isRefused) throw buildMismatchError(dbPath, stamp, root, fingerprint);
  const needsWrite = verdict.action !== 'ok' && options.readOnly !== true;
  if (needsWrite) writeStamp(db, root, fingerprint);
  return { ...verdict, root, fingerprint };
};

// openIndexDb hook: a refused handle is closed before the error propagates, so it is never cached.
export const guardProjectStamp = (db, dbPath, options = {}) => {
  try {
    return applyProjectStamp(db, dbPath, options);
  } catch (err) {
    const isMismatch = err?.code === PROJECT_MISMATCH_CODE;
    if (isMismatch) db.close();
    throw err;
  }
};
