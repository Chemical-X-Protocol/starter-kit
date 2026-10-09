// One run's view of the Forge ledger (design doc, INCREMENTAL PATH). It loads every file stamp once,
// says per file whether it needs fingerprinting (a changed sha1 or extractor version), applies the
// store floor and per-file cap, writes changed files in bounded transactions and keeps the run's
// dirty fp set in memory for the group refresh. Used by the audit, `chemx patterns --sync` and
// fingerprintFile, so all three write identical rows.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withIndexTransaction } from '../search-index-write.js';
import { toRootRelative } from '../search-root.js';
import { ANY_DEPTH_IGNORED_DIRS, ROOT_ONLY_IGNORED_DIRS } from '../search-scan.js';
import { createFacetResolver, packageRootOfKey, withPackageRoot } from './facets.js';
import { isForgeExcluded } from './exclusions.js';
import { isForgeSource } from './file-units.js';
import { createFileFingerprint } from './fingerprint-visitors.js';
import { selectStoredUnits, STORE_FLOOR } from './unit-floor.js';
import {
  readFileStamps, isStampCurrent, replaceFileUnits, removeLedgerFiles, touchFileStamp, stampExtractorVersion, countLedgerUnits,
  updateFileFacet, FORGE_EXTRACTOR_VERSION
} from './store.js';

export const contentHashOf = (content) => crypto.createHash('sha1').update(content).digest('hex');

const writeStderr = (line) => process.stderr.write(`${line}\n`);

const UNBOUNDED = Object.freeze({ share: 1, allowanceChars: Infinity });

// Inside the root and outside the dirs the audit and search never read (worktree copies, stores,
// root-level scratch): an edit there never reaches the ledger.
const isProjectPath = (relPath) => {
  const segments = relPath.split('/');
  const isOutside = segments[0] === '..' || path.isAbsolute(relPath);
  const isIgnoredDir = segments.slice(0, -1).some((segment) => ANY_DEPTH_IGNORED_DIRS.has(segment));
  const isRootIgnored = segments.length > 1 && ROOT_ONLY_IGNORED_DIRS.has(segments[0]);
  return !isOutside && !isIgnoredDir && !isRootIgnored;
};

/** { mtimeMs, size } of a file, mtime truncated to whole ms as the ledger stores it; zeros when gone. */
export const statOf = (fullPath) => {
  try {
    const stat = fs.statSync(fullPath);
    return { mtimeMs: Math.trunc(stat.mtimeMs), size: stat.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
};

/**
 * session over an open, writable index db. options: { root, log, batchSize, budget }. root is the
 * index root (ledger paths are relative to it); log receives one line per file that hits the row cap.
 * budget { share, allowanceChars } bounds the work per run by content size: a changed file is
 * fingerprinted only while the fingerprinted characters stay within share * (characters of every file
 * seen so far) + allowanceChars. A deferred file keeps its old stamp, so the next run or
 * `chemx patterns --sync` picks it up. The choice depends on content and order only, never on time.
 */
export const createForgeSession = (db, { root, log = writeStderr, batchSize = 100, budget = UNBOUNDED } = {}) => {
  const stamps = readFileStamps(db);
  const facets = createFacetResolver(root);
  const dirty = new Set();
  const stats = { fingerprinted: 0, unchanged: 0, deferred: 0, touched: 0, removed: 0, capped: 0, errors: 0, rows: 0, refaceted: 0 };
  const open = new Map();
  const work = { seenChars: 0, fingerprintedChars: 0 };
  let queue = [];

  const claimBudget = (chars) => {
    const limit = budget.share * work.seenChars + budget.allowanceChars;
    const isWithinBudget = work.fingerprintedChars + chars <= limit;
    work.fingerprintedChars += isWithinBudget ? chars : 0;
    return isWithinBudget;
  };

  const relativeOf = (fullPath) => toRootRelative(fullPath, root);
  const markDirty = (fps) => fps.forEach((fp) => dirty.add(fp));

  const flush = () => {
    const batch = queue;
    queue = [];
    const hasBatch = batch.length > 0;
    if (!hasBatch) return;
    withIndexTransaction(db, () => {
      for (const record of batch) {
        const { previousFps, nextFps } = replaceFileUnits(db, record);
        markDirty(previousFps);
        markDirty(nextFps);
      }
    });
  };

  const remove = (relPaths) => {
    const known = relPaths.filter((relPath) => stamps.has(relPath));
    const hasKnown = known.length > 0;
    if (!hasKnown) return;
    flush();
    markDirty(removeLedgerFiles(db, known));
    known.forEach((relPath) => stamps.delete(relPath));
    stats.removed += known.length;
  };

  const record = (relPath, entry, collected) => {
    const selected = selectStoredUnits(collected.units, { isSpec: entry.facet.spec });
    const isCapped = selected.capDropped > 0;
    if (isCapped) log(`forge: ${relPath} kept ${selected.units.length} units, ${selected.capDropped} over the ${STORE_FLOOR.maxUnitsPerFile}-row cap dropped`);
    stats.capped += isCapped ? 1 : 0;
    stats.errors += collected.error ? 1 : 0;
    stats.fingerprinted += 1;
    stats.rows += selected.units.length;
    const stat = entry.stat ?? statOf(path.join(root, relPath));
    queue.push({ path: relPath, contentHash: entry.contentHash, ...stat, facet: entry.facet, units: selected.units, droppedCount: selected.capDropped });
    stamps.set(relPath, { contentHash: entry.contentHash, ...stat, extractorVersion: FORGE_EXTRACTOR_VERSION, facetKey: entry.facet.key });
    const isBatchFull = queue.length >= batchSize;
    if (isBatchFull) flush();
  };

  /**
   * Re-facets an unchanged file whose package root moved (a package.json appeared or went away):
   * the content stamp cannot see that, so every unchanged file is checked by path.
   */
  const refreshFacet = (relPath) => {
    const stamp = stamps.get(relPath);
    const storedKey = stamp?.facetKey;
    if (!storedKey) return;
    const packageRoot = facets.packageRootOfFile(relPath);
    const isSameRoot = packageRootOfKey(storedKey) === packageRoot;
    if (isSameRoot) return;
    flush();
    const facetKey = withPackageRoot(storedKey, packageRoot);
    markDirty(updateFileFacet(db, relPath, facetKey));
    stamps.set(relPath, { ...stamp, facetKey });
    stats.refaceted += 1;
  };

  /**
   * Starts one file. Returns a collector (createFileFingerprint) when the file needs fingerprinting,
   * or null when it is unchanged, excluded or not a Forge source (the audit's options.fingerprint=false).
   */
  const beginFile = (fullPath, content, stat = null) => {
    const relPath = relativeOf(fullPath);
    const isTracked = isProjectPath(relPath) && isForgeSource(relPath) && !isForgeExcluded(relPath, content);
    if (!isTracked) {
      remove([relPath]);
      return null;
    }
    work.seenChars += content.length;
    const contentHash = contentHashOf(content);
    const stamp = stamps.get(relPath);
    const isUnchanged = isStampCurrent(stamp, contentHash);
    stats.unchanged += isUnchanged ? 1 : 0;
    if (isUnchanged) {
      refreshFacet(relPath);
      return null;
    }
    const isOverBudget = !claimBudget(content.length);
    stats.deferred += isOverBudget ? 1 : 0;
    if (isOverBudget) return null;
    const fingerprint = createFileFingerprint(relPath);
    open.set(fingerprint, { contentHash, stat, facet: facets.facetOf(relPath, content) });
    return fingerprint;
  };

  /**
   * Stores a collector from beginFile: what the audit traverse fed it, or `collected` when the caller
   * computed the units itself (collectFileUnits, outside an audit).
   */
  const commitFile = (fingerprint, collected = null) => {
    const entry = open.get(fingerprint);
    open.delete(fingerprint);
    if (entry) record(fingerprint.relativePath, entry, collected ?? fingerprint.result());
  };

  /** Same content under a new mtime/size: refresh the prefilter stamp only. */
  const touch = (fullPath, stat) => {
    const relPath = relativeOf(fullPath);
    touchFileStamp(db, relPath, stat);
    stamps.set(relPath, { ...stamps.get(relPath), ...stat });
    stats.touched += 1;
  };

  /** Removes ledger files under scopeRel (root-relative, '.' for all) that no longer exist on disk. */
  const pruneMissing = (scopeRel = '.') => {
    const prefix = scopeRel === '.' ? '' : `${scopeRel.replace(/\/+$/, '')}/`;
    const isGone = (relPath) => relPath.startsWith(prefix) && !fs.existsSync(path.join(root, relPath));
    remove([...stamps.keys()].filter(isGone));
  };

  const finish = () => {
    flush();
    stampExtractorVersion(db);
    return { ...stats, dirty: dirty.size, ledgerRows: countLedgerUnits(db), extractorVersion: FORGE_EXTRACTOR_VERSION };
  };

  return {
    beginFile, commitFile, touch, pruneMissing, finish, flush,
    forget: (fullPath) => remove([relativeOf(fullPath)]),
    noteUnchanged: (fullPath) => {
      stats.unchanged += 1;
      refreshFacet(relativeOf(fullPath));
    },
    stampOf: (fullPath) => stamps.get(relativeOf(fullPath)) ?? null,
    relativeOf,
    dirty,
    stats
  };
};
