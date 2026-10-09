// Names for a Forge piece (engine doc, HOLES AND NEEDS: params and holes come from the LGG plus naming):
//   1. a matched library piece names itself (its exportName);
//   2. else the subtokens more than half of the members' own or enclosing function names share, a verb or
//      is/has first;
//   3. else the group's shared call anchors, prefixed `is` for an expression and `apply` otherwise.
// The result is a judgment hole's default (a `name` hole, tier light): { name, candidates, source }. A
// name another function of a member file or of the piece module already declares is never offered.
import { sharedAnchors, byCodePoint } from './group-shape.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PREDICATE_PREFIXES = new Set(['is', 'has', 'can', 'should']);
const VERBS = new Set(['add', 'apply', 'build', 'check', 'collect', 'compute', 'create', 'find', 'format', 'get', 'handle', 'load', 'make', 'normalize', 'parse', 'read', 'render', 'resolve', 'run', 'set', 'to', 'update', 'validate', 'write']);
const MAX_TOKENS = 4;
const MAX_CANDIDATES = 3;

/** Lower-case subtokens of an identifier: readJsonOr -> [read, json, or]; names split at case, _ and -. */
export const tokensOf = (identifier) => String(identifier ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/[^A-Za-z0-9]+/g, ' ')
  .trim()
  .toLowerCase()
  .split(' ')
  .filter(Boolean);

const capital = (token) => token.charAt(0).toUpperCase() + token.slice(1);

export const camelOf = (tokens) => tokens.map((token, index) => (index === 0 ? token : capital(token))).join('');

export const pascalOf = (tokens) => tokens.map(capital).join('');

export const kebabOf = (tokens) => tokens.join('-');

export const isIdentifier = (text) => IDENTIFIER.test(text ?? '');

const isVerb = (token) => VERBS.has(token) || PREDICATE_PREFIXES.has(token);

// Tokens that more than half of the lists share, in the order of their first appearance, a verb first.
export const majorityTokens = (lists) => {
  const counts = new Map();
  for (const list of lists) for (const token of new Set(list)) counts.set(token, (counts.get(token) ?? 0) + 1);
  const kept = new Set([...counts].filter(([, count]) => count * 2 > lists.length).map(([token]) => token));
  const ordered = [...new Set(lists.flat().filter((token) => kept.has(token)))];
  const verbIndex = ordered.findIndex(isVerb);
  const isVerbFirst = verbIndex <= 0;
  if (isVerbFirst) return ordered;
  return [ordered[verbIndex], ...ordered.slice(0, verbIndex), ...ordered.slice(verbIndex + 1)];
};

const anchorName = (anchor) => anchor.replace(/^[a-z]+:/, '').replace(/#.*$/, '');

const callTokens = (anchors) => anchors.filter((anchor) => anchor.startsWith('call:')).sort(byCodePoint).flatMap((anchor) => tokensOf(anchorName(anchor)));

const nounTokens = (anchors) => anchors.filter((anchor) => /^(global|import):/.test(anchor)).sort(byCodePoint).flatMap((anchor) => tokensOf(anchorName(anchor)));

const withPredicate = (tokens, isExpression) => {
  const hasPrefix = tokens.length > 0 && (PREDICATE_PREFIXES.has(tokens[0]) || (!isExpression && isVerb(tokens[0])));
  if (hasPrefix) return tokens;
  return [isExpression ? 'is' : 'apply', ...tokens];
};

const uniqueTokens = (tokens) => [...new Set(tokens)];

/** Names of the members' own or enclosing functions as token lists (a member with none is skipped). */
export const memberNameTokens = (group, context) => group.instances
  .map((instance) => context.enclosingNameOf(instance))
  .filter(Boolean)
  .map(tokensOf);

const isFree = (name, taken) => isIdentifier(name) && !taken.has(name);

const rootKindOf = (group) => group.instances[0]?.kind;

/**
 * Names a group. context: { enclosingNameOf(instance), takenNames: Set of names the piece module and the
 * member files already declare }. library: the matched entry ({ exportName }) or null.
 * Returns { name, candidates, source } with source library, members, anchors or fallback.
 */
export const nameGroup = (group, context, library = null) => {
  const taken = context.takenNames ?? new Set();
  const anchors = sharedAnchors(group.instances);
  const isExpression = rootKindOf(group) === 'expr';
  const fromMembers = majorityTokens(memberNameTokens(group, context));
  const noun = nounTokens(anchors).filter((token) => !fromMembers.includes(token));
  // A lone predicate prefix ('is') is completed by the first call-anchor word it lacks (isAbsolute), else by a module noun.
  const isLonePrefix = fromMembers.length === 1 && PREDICATE_PREFIXES.has(fromMembers[0]);
  const callWord = callTokens(anchors).find((token) => !PREDICATE_PREFIXES.has(token) && !fromMembers.includes(token));
  const completion = isLonePrefix && callWord ? [callWord] : noun.slice(0, 1);
  const memberTokens = fromMembers.length > 0 && fromMembers.length < 2 ? [...fromMembers, ...completion] : fromMembers;
  const anchorTokens = withPredicate(uniqueTokens([...callTokens(anchors), ...noun]).slice(0, MAX_TOKENS), isExpression);
  const ranked = [
    ...(library ? [[library.exportName, 'library']] : []),
    ...(memberTokens.length > 0 ? [[camelOf(memberTokens.slice(0, MAX_TOKENS)), 'members']] : []),
    ...(anchors.length > 0 ? [[camelOf(anchorTokens), 'anchors']] : []),
    ['sharedPiece', 'fallback']
  ];
  const free = ranked.filter(([name]) => isFree(name, taken));
  const [first] = free.length > 0 ? free : [[`${ranked[0][0]}2`, ranked[0][1]]];
  const candidates = [...new Set(free.map(([name]) => name))].slice(0, MAX_CANDIDATES);
  return { name: first[0], candidates: candidates.length > 0 ? candidates : [first[0]], source: first[1] };
};
