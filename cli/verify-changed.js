// `chemx verify --changed`: the audit covers only the changed source files and the tests only
// the affected specs; typecheck stays whole-project (types cross every file) and says so.
import path from 'node:path';
import { listChangedFiles } from './test-changes.js';
import { isSourceFilePath } from './audit-preflight-git.js';

// Returns { ok, base, files } (root-relative source files that still exist) or { ok: false, error }.
export const resolveVerifyChanges = (root, base = null) => {
  const listing = listChangedFiles(root, { base });
  if (!listing.ok) return { ok: false, error: listing.error };
  const files = listing.files.filter((f) => f.status !== 'D' && isSourceFilePath(f.path)).map((f) => f.path);
  return { ok: true, base: listing.base, files };
};

export const changedAuditOptions = (root, changes) => ({ fileList: changes.files.map((file) => path.join(root, file)) });

export const testArgsFor = (changes, base) => (changes ? ['--changed', ...(base ? [`--base=${base}`] : [])] : []);
