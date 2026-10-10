// Staleness (engine doc, Heal: SAFETY SEQUENCE 1): each member is re-located in the file as it is now,
// by its fp2 and its body hash, so a member that only moved (line drift) is found again and a member whose
// body changed refuses with BLUEPRINT_STALE. Line ranges in the blueprint are informational.
import { collectFileUnits } from './file-units.js';
import { HealError, bodyHashOf, fileHashOf, parseModuleText } from './heal-text.js';

const SKIPPED = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

const isNode = (value) => Boolean(value) && typeof value === 'object' && typeof value.type === 'string';

/** The outermost AST node spanning exactly [start, end), or null. */
export const nodeAt = (ast, start, end) => {
  const stack = [ast.program];
  while (stack.length > 0) {
    const node = stack.pop();
    const isExact = node.start === start && node.end === end;
    if (isExact) return node;
    const isAround = node.start <= start && node.end >= end;
    if (!isAround) continue;
    for (const [key, value] of Object.entries(node)) {
      const isChildKey = !SKIPPED.has(key);
      if (isChildKey) stack.push(...(Array.isArray(value) ? value : [value]).filter(isNode));
    }
  }
  return null;
};

const stale = (site, why) => new HealError('BLUEPRINT_STALE', `${site.file}:${site.range[0]}-${site.range[1]} ${why}; run chemx blueprint again`, { file: site.file });

const candidatesFor = (site, text, units) => {
  const sameFp = units.filter((unit) => unit.fp2 === site.memberFp);
  const hasBodyHash = typeof site.bodyHash === 'string';
  if (hasBodyHash) return sameFp.filter((unit) => bodyHashOf(text.slice(unit.startOffset, unit.endOffset)) === site.bodyHash);
  const isSameFile = fileHashOf(text) === site.contentHash;
  if (isSameFile) return sameFp.filter((unit) => unit.start === site.range[0]);
  throw stale(site, 'changed, and the blueprint predates body hashes, so a move cannot be told from an edit');
};

const nearest = (candidates, line, taken) => candidates
  .filter((unit) => !taken.has(unit.startOffset))
  .sort((a, b) => Math.abs(a.start - line) - Math.abs(b.start - line) || a.start - b.start)[0] ?? null;

/**
 * Locates every call site in the current texts. readFile(relative) -> text | null. Returns one
 * { site, file, text, ast, node, start, end, line, moved } per call site, in blueprint order. Throws
 * BLUEPRINT_STALE when a member file is gone, no longer parses, or holds no unit with the member's fp2
 * and body hash.
 */
export const locateSites = (callSites, readFile) => {
  const files = new Map();
  const taken = new Map();
  return callSites.map((site) => {
    const text = readFile(site.file);
    const isMissing = typeof text !== 'string';
    if (isMissing) throw stale(site, 'is gone (the file no longer exists)');
    const known = files.get(site.file) ?? { units: collectFileUnits(site.file, text), ast: null };
    files.set(site.file, known);
    const hasParseError = Boolean(known.units.error);
    if (hasParseError) throw stale(site, `no longer parses (${known.units.error.message})`);
    const used = taken.get(site.file) ?? new Set();
    taken.set(site.file, used);
    const unit = nearest(candidatesFor(site, text, known.units.units), site.range[0], used);
    if (!unit) throw stale(site, 'changed: no unit in the file has the member fp and body any more');
    used.add(unit.startOffset);
    known.ast = known.ast ?? parseModuleText(text, site.file);
    const node = nodeAt(known.ast, unit.startOffset, unit.endOffset);
    if (!node) throw stale(site, 'has no AST node at the unit span');
    return { site, file: site.file, text, ast: known.ast, node, start: unit.startOffset, end: unit.endOffset, line: unit.start, moved: unit.start !== site.range[0] };
  });
};
