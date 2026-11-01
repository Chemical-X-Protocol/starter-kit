/**
 * Pure validator for language records (design spec 4.2). A record is plain data: no functions,
 * no RegExp objects, no class instances. Every violation carries the dotted path of the value.
 * Hook and resolver names are checked against `vocab.js`; that the module behind a name exists
 * is the wiring spec's job, so this file stays free of filesystem access.
 */
import * as V from './vocab.js';

// Schema nodes are small plain objects; `check(node, value, path, errors)` interprets them.
const str = { t: 'str' };
const bool = { t: 'bool' };
const int = (min) => ({ t: 'int', min });
const en = (values) => ({ t: 'enum', values });
const arr = (of) => ({ t: 'arr', of });
const map = (of, keys) => ({ t: 'map', of, keys });
const obj = (fields, optional = []) => ({ t: 'obj', fields, optional });
const union = (...options) => ({ t: 'union', options });
const strList = arr(str);
const glob = { t: 'glob' };
const regex = { t: 'regex' };
const globs = arr(glob);
const regexes = arr(regex);
const hook = (values) => ({ t: 'enum', values, what: 'hook' });
const data = { t: 'data' };

const engine = en(V.ENGINES);
const kind = en(V.SYMBOL_KINDS);

const exportRule = {
  t: 'tagged', tag: 'kind', values: V.EXPORT_RULE_KINDS, variants: {
    all: obj({ kind: str }), 'top-level-only': obj({ kind: str }), capture: obj({ kind: str }),
    'name-capitalized': obj({ kind: str }),
    'name-not-prefix': obj({ kind: str, prefix: str }),
    modifier: obj({ kind: str, anyOf: strList, noneOf: strList, default: bool }, ['noneOf'])
  }
};

const tieBreak = obj({ when: obj({ sibling: glob, ancestor: glob }, ['sibling', 'ancestor']), pick: str });

const files = obj({
  extensions: arr({ t: 'ext' }), filenames: strList, paths: globs, shebangs: strList,
  ambiguous: map(obj({
    markers: arr(obj({ re: regex, weight: { t: 'num' } })), minScore: { t: 'num' }, tieBreak: arr(tieBreak)
  }, ['tieBreak'])),
  exclude: globs, declaration: globs, generated: globs, generatedMarkers: regexes,
  vendorDirs: arr(obj({ name: str, when: union(en(V.VENDOR_WHEN), obj({ sibling: glob })) })),
  tests: obj({ names: globs, dirs: strList, contentMarkers: regexes }, ['dirs', 'contentMarkers']),
  regions: hook(V.REGION_HOOKS),
  dialects: obj({ default: str, byExtension: map(str) }, ['byExtension'])
}, ['filenames', 'paths', 'shebangs', 'ambiguous', 'exclude', 'declaration', 'generated', 'generatedMarkers',
  'vendorDirs', 'regions', 'dialects']);

const syntax = obj({
  lineComment: strList,
  blockComment: arr(obj({ open: str, close: str, nests: bool }, ['nests'])),
  docString: arr(obj({ open: str, close: str })),
  strings: arr(obj({
    open: str, close: str, escape: { t: 'nullable', of: str }, raw: bool, multiline: bool
  }, ['raw', 'multiline'])),
  blockStyle: en(V.BLOCK_STYLES), blockOpeners: strList, endKeywords: strList, keywords: strList,
  qualifier: en(V.QUALIFIERS)
}, ['docString', 'blockOpeners', 'endKeywords']);

const parse = obj({
  grammar: union(str, map(str)), queries: str, inheritQueries: strList,
  grammarStatus: en(V.GRAMMAR_STATUSES), errorPolicy: en(V.ERROR_POLICIES),
  maxBytes: int(1), timeBudgetMs: int(1)
}, ['grammar', 'queries', 'inheritQueries', 'maxBytes', 'timeBudgetMs']);

const symbols = obj({
  exportRule, memberKinds: map(kind, V.SYMBOL_KINDS),
  constructorRule: obj({ names: strList, nameEqualsContainer: bool }, ['names', 'nameEqualsContainer']),
  indexKinds: arr(kind)
}, ['memberKinds', 'constructorRule', 'indexKinds']);

const imports = obj({
  resolver: en(V.RESOLVER_NAMES), options: data, normalize: hook(V.IMPORT_NORMALIZERS),
  implicitEdges: arr(hook(V.IMPLICIT_EDGE_HOOKS))
}, ['options', 'normalize', 'implicitEdges']);

const layout = obj({
  tiers: arr(obj({ glob, tier: en(V.LAYOUT_TIERS) })), entryPoints: globs, viewMarkup: bool
}, ['tiers', 'entryPoints', 'viewMarkup']);

const audit = obj({
  analysisRevision: int(0), passes: arr(en(V.PASS_NAMES)), analyzer: hook(V.ANALYZER_HOOKS),
  defaultOff: strList, droppedTextRules: strList, envAccess: regexes, fakeGreen: regexes, deltaGate: bool
}, ['analyzer', 'defaultOff', 'droppedTextRules', 'envAccess', 'fakeGreen', 'deltaGate']);

export const LANGUAGE_RECORD_SCHEMA = obj({
  id: { t: 'id' }, name: str, version: int(0), legacyId: en(V.LEGACY_IDS), reportAs: str,
  files, syntax, parse,
  engines: obj(Object.fromEntries(V.ENGINE_SLOTS.map((s) => [s, engine]))),
  stages: map(en(V.STAGES), V.CAPABILITIES),
  fallback: str, symbols, imports, layout, ecosystems: strList, audit,
  notApplicable: map({ t: 'reason' }, V.NA_FEATURES)
}, ['legacyId', 'reportAs', 'fallback']);

const PLAIN_PROTOTYPES = [Object.prototype, null];
const isObjectLike = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlain = (v) => isObjectLike(v) && PLAIN_PROTOTYPES.includes(Object.getPrototypeOf(v));
const join = (path, key) => (path ? `${path}.${key}` : key);
const rootName = (path) => path || '<root>';
const expect = (ok, message) => (ok ? null : message);

function describeValue(v) {
  const isRegExp = v instanceof RegExp;
  const isFunction = typeof v === 'function';
  const isInstance = isObjectLike(v) && !isPlain(v);
  const special = [
    [isRegExp, 'a RegExp object (use a source string)'],
    [isFunction, 'a function (records are plain data)'],
    [isInstance, `a ${v?.constructor?.name ?? 'non-plain'} instance`]
  ].find(([hit]) => hit);
  const plainTypes = [[v === null, 'null'], [Array.isArray(v), 'array']];
  const [, base = typeof v] = plainTypes.find(([hit]) => hit) ?? [];
  return special ? special[1] : base;
}

const BRACE_DELTA = { '{': 1, '}': -1 };

function braceProblem(src) {
  let depth = 0;
  for (const c of src) {
    depth += BRACE_DELTA[c] ?? 0;
    const closedEarly = depth < 0;
    if (closedEarly) return 'unbalanced } in glob';
  }
  return depth > 0 ? 'unclosed { in glob' : null;
}

/** A glob compiles when it is non-empty, has no NUL and balanced `[]` and `{}` (escapes honored). */
export function globProblem(src) {
  const isEmpty = typeof src !== 'string' || src === '';
  const hasNul = !isEmpty && src.includes('\0');
  const stripped = isEmpty ? '' : src.replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  const hasOpenClass = stripped.includes('[');
  const problems = [
    [isEmpty, 'empty glob'], [hasNul, 'glob contains a NUL byte'], [hasOpenClass, 'unclosed [ in glob']
  ];
  const hit = problems.find(([bad]) => bad);
  return hit ? hit[1] : braceProblem(stripped);
}

function regexProblem(src) {
  try {
    new RegExp(src);
    return null;
  } catch (e) {
    return `regex does not compile: ${e.message}`;
  }
}

const ID_PATTERN = /^[a-z][a-z0-9]*$/;
const EXT_PATTERN = /^\.[^./\\\s]+(\.[^./\\\s]+)*$/;
const isString = (v) => typeof v === 'string';
const isNonEmptyString = (v) => isString(v) && v.trim() !== '';
const isInt = (v, min) => Number.isInteger(v) && v >= min;

/** Leaf checks: each returns a message, or null when the value is fine. */
const LEAF = {
  str: (n, v) => expect(isString(v), `expected a string, got ${describeValue(v)}`),
  bool: (n, v) => expect(typeof v === 'boolean', `expected a boolean, got ${describeValue(v)}`),
  num: (n, v) => expect(Number.isFinite(v), `expected a number, got ${describeValue(v)}`),
  int: (n, v) => expect(isInt(v, n.min), `expected an integer >= ${n.min}, got ${describeValue(v)}`),
  id: (n, v) => expect(isString(v) && ID_PATTERN.test(v), `expected an id matching ${ID_PATTERN}`),
  ext: (n, v) => expect(isString(v) && EXT_PATTERN.test(v), 'expected a dotted extension such as ".go"'),
  reason: (n, v) => expect(isNonEmptyString(v), 'expected a non-empty reason string'),
  glob: (n, v) => (isString(v) ? globProblem(v) : `expected a glob source string, got ${describeValue(v)}`),
  regex: (n, v) => (isString(v) ? regexProblem(v) : `expected a regex source string, got ${describeValue(v)}`),
  enum: (n, v) => enumProblem(n, v)
};

function enumProblem(node, value) {
  const isKnown = isString(value) && node.values.includes(value);
  if (isKnown) return null;
  const what = node.what === 'hook' ? 'hook name' : 'value';
  const known = node.values.length ? node.values.join(', ') : '(none registered)';
  const shown = isString(value) ? JSON.stringify(value) : describeValue(value);
  return `unknown ${what} ${shown}; expected one of: ${known}`;
}

function checkData(value, path, errors) {
  const isScalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);
  const isList = Array.isArray(value);
  const isForeign = !isScalar && !isList && !isPlain(value);
  if (isScalar) return;
  if (isList) return value.forEach((v, i) => checkData(v, `${path}[${i}]`, errors));
  if (isForeign) return errors.push({ path, message: `expected plain data, got ${describeValue(value)}` });
  Object.entries(value).forEach(([k, v]) => checkData(v, join(path, k), errors));
}

function expectObject(value, path, errors) {
  const ok = isPlain(value);
  if (!ok) errors.push({ path: rootName(path), message: `expected an object, got ${describeValue(value)}` });
  return ok;
}

function checkObject(node, value, path, errors) {
  const isObject = expectObject(value, path, errors);
  if (!isObject) return;
  const unknownKeys = Object.keys(value).filter((key) => !(key in node.fields));
  unknownKeys.forEach((key) => errors.push({ path: join(path, key), message: 'unknown key' }));
  for (const [key, child] of Object.entries(node.fields)) {
    const present = value[key] !== undefined;
    const missing = !present && !node.optional.includes(key);
    if (present) check(child, value[key], join(path, key), errors);
    if (missing) errors.push({ path: join(path, key), message: 'required' });
  }
}

function checkArray(node, value, path, errors) {
  const ok = Array.isArray(value);
  if (!ok) errors.push({ path: rootName(path), message: `expected an array, got ${describeValue(value)}` });
  if (ok) value.forEach((v, i) => check(node.of, v, `${path}[${i}]`, errors));
}

function checkMap(node, value, path, errors) {
  const isObject = expectObject(value, path, errors);
  if (!isObject) return;
  for (const [key, child] of Object.entries(value)) {
    const known = !node.keys || node.keys.includes(key);
    if (known) check(node.of, child, join(path, key), errors);
    else errors.push({ path: join(path, key), message: `unknown key; expected one of: ${node.keys.join(', ')}` });
  }
}

function checkTagged(node, value, path, errors) {
  const isObject = expectObject(value, path, errors);
  if (!isObject) return;
  const tag = value[node.tag];
  const known = node.values.includes(tag);
  const message = enumProblem({ values: node.values }, tag);
  if (known) checkObject(node.variants[tag], value, path, errors);
  else errors.push({ path: join(path, node.tag), message });
}

// A union reports the errors of the branch whose outer shape the value already has.
const SHAPE_MATCHES = { str: isString, enum: isString, map: isPlain, obj: isPlain };

function checkUnion(node, value, path, errors) {
  const trials = node.options.map((option) => {
    const found = [];
    check(option, value, path, found);
    return found;
  });
  const passes = trials.some((found) => found.length === 0);
  const shaped = trials.findIndex((found, i) => SHAPE_MATCHES[node.options[i].t]?.(value));
  const fallback = [{ path: rootName(path), message: 'does not match any allowed shape' }];
  if (!passes) errors.push(...(shaped >= 0 ? trials[shaped] : fallback));
}

function checkNullable(node, value, path, errors) {
  const isNull = value === null;
  if (!isNull) check(node.of, value, path, errors);
}

const COMPOSITE = {
  obj: checkObject, arr: checkArray, map: checkMap, tagged: checkTagged, union: checkUnion,
  nullable: checkNullable, data: (node, value, path, errors) => checkData(value, rootName(path), errors)
};

function check(node, value, path, errors) {
  const leaf = LEAF[node.t];
  const composite = COMPOSITE[node.t];
  const message = leaf?.(node, value);
  if (message) errors.push({ path: rootName(path), message });
  if (composite) composite(node, value, path, errors);
  const isUnknownNode = !leaf && !composite;
  if (isUnknownNode) throw new Error(`schema: unknown node type ${node.t}`);
}

/** @returns {{ ok: boolean, errors: { path: string, message: string }[] }} */
export function validateLanguageRecord(record) {
  const errors = [];
  check(LANGUAGE_RECORD_SCHEMA, record, '', errors);
  return { ok: errors.length === 0, errors };
}

/** Throws one Error listing every violation; returns the record unchanged when valid. */
export function assertLanguageRecord(record) {
  const { ok, errors } = validateLanguageRecord(record);
  const id = isPlain(record) && isString(record.id) ? record.id : '?';
  const lines = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
  const isInvalid = !ok;
  if (isInvalid) throw new Error(`language record "${id}" is invalid:\n${lines}`);
  return record;
}
