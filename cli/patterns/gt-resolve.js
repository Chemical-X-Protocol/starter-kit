// Loads labels.json and re-finds every anchor by CONTENT in the live repo, so labels survive line shifts.
// An anchor whose excerpt no longer appears in its file is reported stale (and ignored when scoring).
import fs from 'node:fs';
import path from 'node:path';
import { parseFixture, findExcerptHits, assignOrderedHits, excerptHash } from './gt-text.js';

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

// Anchors of the same file with identical text (A23.1-A23.4 are one repeated line) must land on distinct
// hits, in file order, or two labels would collapse onto one span and the other site would go unlabeled.
const resolveGroup = (entries, fileLines) => {
  const hits = fileLines ? findExcerptHits(fileLines, entries[0].excerptLines) : [];
  const spans = assignOrderedHits(entries.map((entry) => entry.anchor), hits);
  entries.forEach((entry, index) => {
    entry.resolved = { ...entry.anchor, span: spans[index], isStale: spans[index] === null, hashMatches: excerptHash(entry.excerptLines) === entry.anchor.hash };
  });
};

const groupBySameText = (entries) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.anchor.file}\0${excerptHash(entry.excerptLines)}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
};

export const resolveLabels = (labels, labelsDir, root) => {
  const fileCache = new Map();
  const linesOf = (file) => {
    const isCached = fileCache.has(file);
    if (!isCached) fileCache.set(file, readFileLines(root, file));
    return fileCache.get(file);
  };
  const entriesByItem = labels.items.map((item) => {
    const excerpts = fixtureExcerpts(labelsDir, item.id);
    return item.anchors.map((anchor) => ({ anchor, excerptLines: excerpts.get(anchor.id) ?? [], resolved: null }));
  });
  for (const group of groupBySameText(entriesByItem.flat())) resolveGroup(group, linesOf(group[0].anchor.file));
  return labels.items.map((item, index) => ({ ...item, anchors: entriesByItem[index].map((entry) => entry.resolved) }));
};

// Anchors whose fixture text no longer matches the hash recorded in labels.json (fixture/label drift).
export const mismatchedAnchorIds = (resolvedItems) => resolvedItems.flatMap((item) => item.anchors.filter((anchor) => !anchor.hashMatches).map((anchor) => anchor.id));

export const staleAnchorIds = (resolvedItems) => resolvedItems.flatMap((item) => item.anchors.filter((anchor) => anchor.isStale).map((anchor) => anchor.id));
