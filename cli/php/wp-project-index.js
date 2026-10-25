// Per-plugin project index (design spec 3.8): the file list, a text prefilter over every file, facts
// on demand, callable resolution, bounded reachability and reverse edges. Facts are plain data from
// php-facts.js; no parse tree is kept here (loadAst goes through the php-parse cache).
// Guarantees: git-ignored files and vendor/ (any depth) are never listed below a listed root; a file
// is parsed only when a lookup needs it; an entry is rebuilt when its size or mtime changes. Not
// guaranteed: a resolved callee runs, calls on untyped variables resolve, or classes declared outside
// the root (another plugin, WordPress core) are seen.
// Paths in and out are posix paths relative to the index root.
import path from 'node:path';
import { parsePhp } from './php-parse.js';
import { extractFacts } from './php-facts.js';
import { createRootState, refreshRootState, overlayEntry, readOrEmpty, lc, toPosix } from './wp-index-files.js';

export { INDEX_MAX_FILES, INDEX_MAX_BYTES, prefilterPhp } from './wp-index-files.js';

const STATIC_REF = /^\\?([A-Za-z_][\w\\]*)::([A-Za-z_]\w*)$/;
const METHOD_RECEIVERS = new Set(['this', 'self', 'static', 'parent', 'static-class', 'var-new', 'new']);
const CLOSURE_FORMS = new Set(['closure', 'arrowfunc']);

const states = new Map();
let clock = () => Date.now();

/** Test seam: replace the clock used for the 30 s re-list window. Returns the previous clock. */
export function setProjectIndexClock(fn) {
  const previous = clock;
  clock = fn || (() => Date.now());
  return previous;
}

/** Drops every cached root (tests, long-lived processes that want a cold index). */
export function resetProjectIndexCache() {
  states.clear();
}

const shortName = (fqn) => String(fqn).split('\\').pop();

function parseRef(text) {
  const match = STATIC_REF.exec(text);
  const fn = text.replace(/^\\/, '');
  return match ? { form: 'static-string', class: match[1], method: match[2] } : { form: 'function', function: fn };
}

function splitTarget(target) {
  const match = typeof target === 'string' ? STATIC_REF.exec(target) : null;
  return match ? { cls: match[1], method: match[2] } : null;
}

function summary(hit) {
  return { id: hit.id, file: hit.file, line: hit.line };
}

/** The callables one registration names: [{ role: 'callback' | 'permission', endpoint, ref }]. */
export function callablesOf(registration) {
  const isRoute = registration.type === 'rest_route';
  const fromRoute = isRoute
    ? registration.endpoints.flatMap((e, endpoint) => [
      { role: 'callback', endpoint, ref: e.callback },
      { role: 'permission', endpoint, ref: e.permission },
    ])
    : [];
  const all = isRoute ? fromRoute : [{ role: 'callback', endpoint: null, ref: registration.callback }];
  return all.filter((c) => Boolean(c.ref));
}

function makeView(state, overlay) {
  const over = overlay && overlay.relativePath ? overlayEntry(state, overlay) : null;
  const overRel = over ? over.rel : null;
  const tables = state.tables;

  const entryOf = (rel) => (rel === overRel ? over : state.entries.get(rel)) || null;
  const contentOf = (entry) => (entry.overlay ? entry.content : readOrEmpty(path.join(state.root, entry.rel)));
  const files = () => {
    const base = [...state.entries.keys()];
    const addOverlay = Boolean(overRel) && !base.includes(overRel);
    return addOverlay ? [...base, overRel].sort() : base;
  };

  const buildFacts = (entry) => {
    const parsed = parsePhp(contentOf(entry), { filePath: entry.rel });
    entry.facts = parsed.ast ? extractFacts(parsed.ast, entry.rel) : null;
    entry.byId = new Map(((entry.facts && entry.facts.functions) || []).map((f) => [lc(f.id), f]));
    state.factsBuilt += 1;
    state.parsed.add(entry.rel);
  };

  /** Level 2: the file's facts (parsed on first use), or null when unlisted or unparsable. */
  const factsOf = (rel) => {
    const entry = entryOf(rel);
    const needsBuild = Boolean(entry) && entry.facts === undefined;
    if (needsBuild) buildFacts(entry);
    return entry ? entry.facts : null;
  };

  const functionById = (rel, id) => {
    const facts = id ? factsOf(rel) : null;
    const fact = facts ? entryOf(rel).byId.get(lc(id)) : null;
    return fact ? { id: fact.id, kind: fact.kind, file: rel, line: fact.line, endLine: fact.endLine, fact } : null;
  };

  const declaring = (table, fqn) => {
    const base = (tables[table].get(lc(fqn)) || []).filter((rel) => rel !== overRel);
    const inOverlay = Boolean(over) && over.pre[table].some((name) => lc(name) === lc(fqn));
    return inOverlay ? [overRel, ...base] : base;
  };

  const classFact = (fqn) => {
    for (const rel of declaring('classes', fqn)) {
      const facts = factsOf(rel);
      const cls = facts ? facts.classes.find((c) => lc(c.fqn) === lc(fqn)) : null;
      if (cls) return { cls, file: rel };
    }
    return null;
  };

  // Own methods first, then traits in `use` order, then the extends chain; each class once.
  const findMethod = (classFqn, method, seen = new Set()) => {
    const key = lc(classFqn);
    const isDone = !classFqn || seen.has(key);
    if (isDone) return null;
    seen.add(key);
    const hit = classFact(classFqn);
    const own = hit ? functionById(hit.file, `${hit.cls.fqn}::${method}`) : null;
    const isSettled = !hit || Boolean(own);
    if (isSettled) return own;
    for (const trait of hit.cls.traits) {
      const found = findMethod(trait, method, seen);
      if (found) return found;
    }
    return findMethod(hit.cls.extends, method, seen);
  };

  const findFunction = (candidates) => {
    for (const name of candidates.filter(Boolean)) {
      const hits = declaring('functions', name).map((rel) => functionById(rel, name));
      const hit = hits.find((h) => Boolean(h) && h.kind === 'function');
      if (hit) return hit;
    }
    return null;
  };

  const viaTarget = (target) => {
    const parts = splitTarget(target);
    return parts ? findMethod(parts.cls, parts.method) : null;
  };

  const resolveCall = (call) => {
    const isFunc = call.receiver === 'func';
    if (isFunc) return findFunction([call.target, call.fallback]);
    return METHOD_RECEIVERS.has(call.receiver) ? viaTarget(call.target) : null;
  };

  const resolveDescriptor = (ref, fromFile) => {
    const isClosure = CLOSURE_FORMS.has(ref.form);
    const isFunction = ref.form === 'function';
    if (isClosure) return functionById(fromFile, ref.closureId || ref.target);
    if (isFunction) return findFunction([ref.function || ref.target]);
    const hasMethod = Boolean(ref.class) && Boolean(ref.method);
    return hasMethod ? findMethod(ref.class, ref.method) : viaTarget(ref.target);
  };

  /**
   * @param ref a callable descriptor from facts (`form`), a call fact (`receiver`), or a string 'fn' / 'C::m'
   * @param fromFile the file the ref was written in (needed for closures)
   * @returns {{id, kind, file, line, endLine, fact} | null} the declaration the ref names, or null
   */
  const resolveCallable = (ref, fromFile = overRel) => {
    const value = typeof ref === 'string' ? parseRef(ref) : ref;
    const isRef = Boolean(value) && typeof value === 'object';
    if (!isRef) return null;
    return value.receiver ? resolveCall(value) : resolveDescriptor(value, fromFile);
  };

  const classAt = (rel, line) => {
    const facts = factsOf(rel);
    const holding = facts ? facts.classes.filter((c) => c.line <= line && line <= c.endLine) : [];
    return holding.length > 0 ? holding[holding.length - 1].fqn : null;
  };

  // A hook-map string ('wp_ajax_x' => 'handler') that names no function is read as a method of the
  // class whose body holds the map, which registers it as [$this, $method].
  const resolveEntry = (registration, ref) => {
    const hit = resolveCallable(ref, registration.file);
    const tryMethod = !hit && registration.type === 'hook_map' && ref.form === 'function';
    const owner = tryMethod ? classAt(registration.file, registration.line) : null;
    return owner ? findMethod(owner, ref.function) : hit;
  };

  /** Each callable of one registration (from registrations()) with its declaration or null. */
  const resolveRegistration = (registration) =>
    callablesOf(registration).map((c) => ({ ...c, target: resolveEntry(registration, c.ref) }));

  /**
   * Breadth-first over resolved calls from ref, at most `hops` calls deep, each declaration once.
   * predicate(fact, { file, depth }) is tested on the start (depth 0) and every reached declaration.
   * @returns {{id, file, line, depth, path} | null} the first declaration the predicate accepts
   */
  const reaches = (ref, predicate, { hops = 2, fromFile = overRel } = {}) => {
    const isResolved = Boolean(ref) && Boolean(ref.fact) && Boolean(ref.file);
    const start = isResolved ? ref : resolveCallable(ref, fromFile);
    if (!start) return null;
    const seen = new Set([`${start.file}#${lc(start.id)}`]);
    const queue = [{ hit: start, depth: 0, path: [summary(start)] }];
    while (queue.length > 0) {
      const { hit, depth, path: trail } = queue.shift();
      const accepted = predicate(hit.fact, { file: hit.file, depth });
      if (accepted) return { ...summary(hit), depth, path: trail };
      const calls = depth < hops ? hit.fact.calls : [];
      const next = calls.map(resolveCall).filter((n) => Boolean(n) && !seen.has(`${n.file}#${lc(n.id)}`));
      for (const n of next) seen.add(`${n.file}#${lc(n.id)}`);
      for (const n of next) queue.push({ hit: n, depth: depth + 1, path: [...trail, summary(n)] });
    }
    return null;
  };

  const registrationFiles = () => {
    const base = tables.registering.filter((rel) => rel !== overRel);
    const overlayRegisters = Boolean(over) && over.pre.registers;
    return overlayRegisters ? [overRel, ...base] : base;
  };

  /** Every registration of every registration-bearing file, each with its `file`. */
  const registrations = () => registrationFiles().flatMap((rel) => {
    const facts = factsOf(rel);
    return facts ? facts.registrations.map((r) => ({ file: rel, ...r })) : [];
  });

  const intoTarget = (target) => (c) => Boolean(c.target) && c.target.file === target;
  const registrationsIn = (rel) => {
    const facts = factsOf(rel);
    return facts ? facts.registrations.map((r) => ({ file: rel, ...r })) : [];
  };
  const registersInto = (registration, target) => resolveRegistration(registration).some(intoTarget(target));

  const dependsOn = (rel, target) => {
    const viaRegistration = registrationsIn(rel).some((r) => registersInto(r, target));
    const facts = viaRegistration ? null : factsOf(rel);
    const calls = facts ? facts.functions.flatMap((f) => f.calls) : [];
    return viaRegistration || calls.some((c) => intoTarget(target)({ target: resolveCall(c) }));
  };

  const alternation = (words) => [...words].join('|');
  const mentionPattern = (words) => new RegExp(`\\b(?:${alternation(words)})\\b`, 'i');
  const inheritPattern = (words) => new RegExp(`\\b(?:extends|use)\\b[^;{]*\\b(?:${alternation(words)})\\b`, 'i');

  // Candidate files name a class or function of the target, or extend/use a class that does (so a
  // $this call in a grandchild class is found). A resolution into the target from any other file has
  // to name one of these. Only files whose text extends or uses a family name are parsed here.
  const candidatesFor = (target, facts) => {
    const words = new Set(facts.classes.map((c) => shortName(c.fqn)));
    for (const f of facts.functions.filter((x) => x.kind === 'function')) words.add(shortName(f.id));
    const family = new Set(facts.classes.map((c) => lc(c.fqn)));
    const found = new Set();
    let grew = words.size > 0;
    while (grew) {
      const [mentions, inherits] = [mentionPattern(words), inheritPattern(words)];
      const texts = files().filter((rel) => rel !== target && !found.has(rel)).map((rel) => [rel, contentOf(entryOf(rel))]);
      const fresh = texts.filter(([, text]) => mentions.test(text));
      for (const [rel] of fresh) found.add(rel);
      const kids = fresh.filter(([, text]) => inherits.test(text)).flatMap(([rel]) => (factsOf(rel) || { classes: [] }).classes)
        .filter((c) => [c.extends, ...c.traits].some((p) => family.has(lc(p))));
      for (const kid of kids) family.add(lc(kid.fqn));
      for (const kid of kids) words.add(shortName(kid.fqn));
      grew = kids.length > 0;
    }
    return found;
  };

  /** Files whose registrations or calls resolve into `relativePath` (reverse edges), sorted. */
  const dependentsOf = (relativePath) => {
    const target = toPosix(relativePath);
    const facts = factsOf(target);
    const candidates = facts ? [...candidatesFor(target, facts)] : [];
    return candidates.filter((rel) => dependsOn(rel, target)).sort();
  };

  /**
   * The registrations a rule on one file needs: those written in it, then those in other
   * registration-bearing files whose callables resolve into it. Files that cannot name the target
   * are not parsed.
   */
  const registrationsFor = (relativePath) => {
    const target = toPosix(relativePath);
    const facts = factsOf(target);
    const registering = new Set(registrationFiles());
    const candidates = facts ? [...candidatesFor(target, facts)].filter((rel) => registering.has(rel)).sort() : [];
    const elsewhere = candidates.flatMap(registrationsIn).filter((r) => registersInto(r, target));
    return [...registrationsIn(target), ...elsewhere];
  };


  /** The parse tree for one file (overlay content for the overlaid file), through the php-parse cache. */
  const loadAst = (relativePath) => {
    const entry = entryOf(toPosix(relativePath));
    const parsed = entry ? parsePhp(contentOf(entry), { filePath: entry.rel }) : null;
    return parsed && parsed.ast ? parsed.ast : null;
  };

  const prefilter = (rel) => {
    const entry = entryOf(rel);
    return entry ? entry.pre : null;
  };

  return {
    root: state.root,
    capped: state.capped,
    files,
    prefilter,
    facts: factsOf,
    loadAst,
    registrations,
    registrationsFor,
    resolveCallable,
    resolveRegistration,
    reaches,
    dependentsOf,
    parsedFiles: () => [...state.parsed].sort(),
    stats: () => ({ files: files().length, bytes: state.bytes, capped: state.capped, factsBuilt: state.factsBuilt }),
  };
}

/**
 * The project index for one plugin or theme root, built lazily and cached per process per root.
 * overlay { relativePath, content } replaces one file's content (relative to root, or absolute;
 * content omitted reads the disk). Above INDEX_MAX_FILES files or INDEX_MAX_BYTES of PHP the index
 * holds only the overlay file and `capped` is true.
 */
export function getProjectIndex(root, { overlay = null } = {}) {
  const abs = path.resolve(root);
  const state = states.get(abs) || createRootState(abs);
  states.set(abs, state);
  refreshRootState(state, clock());
  return makeView(state, overlay);
}
