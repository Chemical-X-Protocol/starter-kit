// Deterministic ground-truth scorer for duplicate-pattern detectors.
// Input: resolved labels (gt-resolve.js) and detector groups { id, path, occurrences: [{ file, startLine, endLine }] }.
// Output: recall per A item (1 = usable group, 0.5 = partial), false-positive hits on B items, borderline
// surfacing, and precision/recall per detection path. No clocks, no randomness, code-point ordering only.
//
// A group credits an A item when it covers >= 2 distinct anchors of that item and is not a swamp:
//   full 1.0   : no foreign sites and >= half of the item's live anchors covered
//   partial 0.5: otherwise, provided foreign sites do not outnumber own sites
//   0          : own sites are under MIN_DENSITY of the group (a bucket that merely brushes the item)
// "Foreign" sites overlap anchors of an unrelated labeled item. Unlabeled sites are neutral.

export const MIN_DENSITY = 0.25;
export const MIN_COVERED = 2;

const byCodePoint = (a, b) => Number(a > b) - Number(a < b);

const overlaps = (anchor, occurrence) => {
  const sameFile = anchor.file === occurrence.file;
  return sameFile && occurrence.startLine <= anchor.span.endLine && occurrence.endLine >= anchor.span.startLine;
};

const indexLiveAnchors = (items) => {
  const byFile = new Map();
  for (const item of items) {
    for (const anchor of item.anchors.filter((a) => !a.isStale)) {
      const list = byFile.get(anchor.file) ?? [];
      list.push({ itemId: item.id, anchor });
      byFile.set(anchor.file, list);
    }
  }
  return byFile;
};

// Items whose anchors may overlap without counting as foreign. B-class (false) items are never excused:
// a false-positive site inside an A group is exactly the contamination the scorer must expose.
const relatedPairs = (items) => {
  const classOf = new Map(items.map((item) => [item.id, item.class]));
  const related = new Map(items.map((item) => [item.id, new Set([item.id])]));
  for (const item of items) {
    const excusable = (item.related ?? []).filter((other) => classOf.get(other) !== 'B' && item.class !== 'B');
    for (const other of excusable) {
      related.get(item.id).add(other);
      related.get(other)?.add(item.id);
    }
  }
  return related;
};

// Per occurrence: which items and anchors it touches.
const touchesOf = (occurrence, anchorIndex) => {
  const candidates = anchorIndex.get(occurrence.file) ?? [];
  return candidates.filter((entry) => overlaps(entry.anchor, occurrence));
};

const statsForItem = (item, touched, related) => {
  const own = touched.filter((touches) => touches.some((t) => t.itemId === item.id));
  const coveredIds = new Set(own.flatMap((touches) => touches.filter((t) => t.itemId === item.id).map((t) => t.anchor.id)));
  const family = related.get(item.id);
  const foreign = touched.filter((touches) => touches.length > 0 && touches.every((t) => !family.has(t.itemId)));
  const liveAnchors = item.anchors.filter((a) => !a.isStale).length;
  return { covered: coveredIds.size, liveAnchors, ownSites: own.length, foreign: foreign.length, total: touched.length };
};

export const creditFor = (stats) => {
  const isCovered = stats.covered >= MIN_COVERED;
  const density = stats.total === 0 ? 0 : stats.ownSites / stats.total;
  const isSwamp = density < MIN_DENSITY;
  const isForeignHeavy = stats.foreign > stats.ownSites;
  const isEligible = isCovered && !isSwamp && !isForeignHeavy;
  const isUsable = stats.foreign === 0 && stats.covered * 2 >= stats.liveAnchors;
  if (!isEligible) return 0;
  return isUsable ? 1 : 0.5;
};

const classifyGroup = (group, items, anchorIndex, related) => {
  const touched = group.occurrences.map((occurrence) => touchesOf(occurrence, anchorIndex));
  const rows = items.map((item) => ({ item, stats: statsForItem(item, touched, related) }));
  const credited = rows.filter((row) => row.item.class === 'A').map((row) => ({ ...row, credit: creditFor(row.stats) })).filter((row) => row.credit > 0);
  const best = credited.sort((a, b) => b.credit - a.credit || b.stats.covered - a.stats.covered || byCodePoint(a.item.id, b.item.id))[0];
  const falseHit = rows.find((row) => row.item.class === 'B' && row.stats.covered >= MIN_COVERED);
  const borderHit = rows.find((row) => row.item.class === 'C' && row.stats.covered >= MIN_COVERED);
  const unlabeledSites = touched.filter((touches) => touches.length === 0).length;
  return { group, credited, best, falseHit, borderHit, unlabeledSites };
};

// Precedence: a credited A item, else a B hit (false positive), else a C hit, else unlabeled.
const verdictOf = (analysis) => {
  const candidates = [
    { kind: 'true', row: analysis.best },
    { kind: 'false', row: analysis.falseHit },
    { kind: 'borderline', row: analysis.borderHit }
  ];
  const hit = candidates.find((candidate) => Boolean(candidate.row));
  const credit = hit?.row?.credit ?? 0;
  return { kind: hit?.kind ?? 'unlabeled', itemId: hit?.row?.item.id ?? null, credit };
};

const bestCreditPerItem = (aItems, analyses) => {
  const credits = new Map(aItems.map((item) => [item.id, { itemId: item.id, credit: 0, groupId: null, path: null, via: null }]));
  for (const analysis of analyses) {
    for (const row of analysis.credited) {
      const current = credits.get(row.item.id);
      const isBetter = row.credit > current.credit;
      if (isBetter) credits.set(row.item.id, { itemId: row.item.id, credit: row.credit, groupId: analysis.group.id, path: analysis.group.path, via: null });
    }
  }
  return credits;
};

const applySubsumption = (aItems, credits) => {
  for (const item of aItems.filter((entry) => entry.subsumedBy)) {
    const parent = credits.get(item.subsumedBy);
    const own = credits.get(item.id);
    const inherits = parent && own && parent.credit > own.credit;
    if (inherits) credits.set(item.id, { ...parent, itemId: item.id, via: item.subsumedBy });
  }
  return credits;
};

const countBy = (keys) => Object.fromEntries([...new Set(keys)].sort(byCodePoint).map((key) => [key, keys.filter((k) => k === key).length]));

const liveAnchors = (item) => item.anchors.filter((a) => !a.isStale);

// An item with fewer live anchors than MIN_COVERED can no longer be credited by any group: its code was healed
// or moved. It leaves the recall denominator and is reported as healed (labels.json keeps it).
const isHealed = (item) => liveAnchors(item).length < MIN_COVERED;

const isSpecItem = (item) => item.anchors.length > 0 && item.anchors.every((a) => /\.(spec|test)\.[cm]?[jt]s$/.test(a.file));

const sumCredit = (rows) => rows.reduce((total, row) => total + row.credit, 0);

const recallSummary = (creditRows) => {
  const total = creditRows.length;
  const credit = sumCredit(creditRows);
  return {
    items: total,
    found: creditRows.filter((row) => row.credit === 1).length,
    partial: creditRows.filter((row) => row.credit === 0.5).length,
    missed: creditRows.filter((row) => row.credit === 0).length,
    credit,
    recall: total === 0 ? 0 : credit / total
  };
};

const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);

const pathSummary = (path, verdicts, creditRows) => {
  const mine = verdicts.filter((entry) => entry.path === path);
  const count = (kind) => mine.filter((entry) => entry.verdict.kind === kind).length;
  const trueGroups = count('true');
  const falseGroups = count('false');
  const itemCredit = sumCredit(creditRows.filter((row) => row.path === path));
  return { groups: mine.length, true: trueGroups, false: falseGroups, borderline: count('borderline'), unlabeled: count('unlabeled'), labeledPrecision: ratio(trueGroups, trueGroups + falseGroups), itemCredit };
};

export const scoreGroups = (resolvedItems, groups) => {
  const anchorIndex = indexLiveAnchors(resolvedItems);
  const related = relatedPairs(resolvedItems);
  const ordered = [...groups].sort((a, b) => byCodePoint(String(a.id), String(b.id)));
  const analyses = ordered.map((group) => classifyGroup(group, resolvedItems, anchorIndex, related));
  const allA = resolvedItems.filter((item) => item.class === 'A');
  const aItems = allA.filter((item) => !isHealed(item));
  const healedItems = allA.filter(isHealed).map((item) => item.id).sort(byCodePoint);
  const credits = applySubsumption(aItems, bestCreditPerItem(aItems, analyses));
  const creditRows = [...credits.values()].sort((a, b) => byCodePoint(a.itemId, b.itemId));
  const specIds = new Set(aItems.filter(isSpecItem).map((item) => item.id));
  const recallByScope = { code: recallSummary(creditRows.filter((row) => !specIds.has(row.itemId))), spec: recallSummary(creditRows.filter((row) => specIds.has(row.itemId))) };
  const verdicts = analyses.map((analysis) => ({ id: analysis.group.id, path: analysis.group.path ?? 'unknown', type: analysis.group.type ?? null, sites: analysis.group.occurrences.length, unlabeledSites: analysis.unlabeledSites, verdict: verdictOf(analysis) }));
  const paths = [...new Set(verdicts.map((entry) => entry.path))].sort(byCodePoint);
  const surfaced = (kind) => [...new Set(verdicts.filter((entry) => entry.verdict.kind === kind).map((entry) => entry.verdict.itemId))].sort(byCodePoint);
  const bItems = resolvedItems.filter((item) => item.class === 'B');
  const trueCount = verdicts.filter((entry) => entry.verdict.kind === 'true').length;
  const falseCount = verdicts.filter((entry) => entry.verdict.kind === 'false').length;
  return {
    schema: 'chemx.gt-score/1',
    groups: verdicts.length,
    recallA: recallSummary(creditRows),
    recallByScope,
    healedItems,
    perItem: creditRows,
    falseItems: { items: bItems.length, surfaced: surfaced('false'), surfacedCount: surfaced('false').length },
    borderlineSurfaced: surfaced('borderline'),
    precision: { labeled: ratio(trueCount, trueCount + falseCount), overall: ratio(trueCount, verdicts.length), trueGroups: trueCount, falseGroups: falseCount, unlabeledGroups: verdicts.filter((entry) => entry.verdict.kind === 'unlabeled').length },
    byType: countBy(verdicts.map((entry) => entry.type ?? 'untyped')),
    perPath: Object.fromEntries(paths.map((path) => [path, pathSummary(path, verdicts, creditRows)])),
    groupVerdicts: verdicts
  };
};
