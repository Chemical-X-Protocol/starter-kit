// Loads labels.json and re-finds every anchor by CONTENT in the live repo, so labels survive line shifts.
// An anchor whose excerpt no longer appears in its file is reported stale (and ignored when scoring).
import fs from 'node:fs';
import path from 'node:path';
import { parseFixture, locateExcerpt, excerptHash } from './gt-text.js';

export const loadLabels = (labelsPath) => JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));

const readFileLines = (root, file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf-8').split('\n');
  } catch {
    return null; // a missing file makes its anchors stale, which the report lists
  }
};

const fixtureExcerpts = (labelsDir, itemId) => {
  const text = fs.readFileSync(path.join(labelsDir, `${itemId}.txt`), 'utf-8');
  return new Map(parseFixture(text).map((entry) => [entry.id, entry.lines]));
};

const resolveAnchor = (anchor, excerptLines, fileLines) => {
  const span = fileLines ? locateExcerpt(fileLines, excerptLines, anchor.startLine) : null;
  const hashMatches = excerptHash(excerptLines) === anchor.hash;
  return { ...anchor, span, isStale: span === null, hashMatches };
};

export const resolveLabels = (labels, labelsDir, root) => {
  const fileCache = new Map();
  const linesOf = (file) => {
    const isCached = fileCache.has(file);
    if (!isCached) fileCache.set(file, readFileLines(root, file));
    return fileCache.get(file);
  };
  return labels.items.map((item) => {
    const excerpts = fixtureExcerpts(labelsDir, item.id);
    const anchors = item.anchors.map((anchor) => resolveAnchor(anchor, excerpts.get(anchor.id) ?? [], linesOf(anchor.file)));
    return { ...item, anchors };
  });
};

export const staleAnchorIds = (resolvedItems) => resolvedItems.flatMap((item) => item.anchors.filter((anchor) => anchor.isStale).map((anchor) => anchor.id));
