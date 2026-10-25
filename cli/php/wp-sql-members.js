// Class members and parameters for the SECURITY_WP_UNPREPARED_SQL classifier (wp-sql-classify.js): whether a
// class property or a private or static method parameter can only hold values the classifier accepts.
// The classifier injects itself as st.classify, so this module does not import it.
import { linkParents } from './php-walk.js';
import {
  textOf, enclosingClass, classNameOf, isOwnClassRef, findClassNamed, propertyDeclaration, propertyAssignments,
  callSites, staticSites,
} from './wp-sql-lookup.js';

export const ROOT_ENV = Object.freeze({ depth: 0, bind: null, bindScope: null });

const WPDB_PROPERTY = /^\$(wpdb|this->wpdb|this->db|db)->\w+$/;
const TABLE_PROPERTY = /^\$this->\w*(table|tbl)\w*$/i;

export const startOf = (node) => (node.loc ? node.loc.start.offset : Number.POSITIVE_INFINITY);
export const nameOfParam = (param) => (param.name && typeof param.name === 'object' ? param.name.name : param.name);
export const nameOfMethod = (method) => String(method.name.name || method.name);
export const fresh = (env) => ({ depth: env.depth, bind: null, bindScope: null });

export function rootOf(node) {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

/** Links parent pointers once per tree (trees loaded from the project index arrive unlinked). */
export function link(st, ast) {
  const needsLink = Boolean(ast) && !st.linked.has(ast);
  if (needsLink) {
    linkParents(ast);
    st.linked.add(ast);
  }
  return ast;
}

// ---- class properties ---------------------------------------------------------------------

function memberReasons(cls, name, isStatic, text, env, st) {
  const decl = cls ? propertyDeclaration(cls, name) : null;
  const isMismatch = !decl || decl.isStatic !== isStatic;
  if (isMismatch) return [`prop:${text}`];
  const key = `${isStatic}:${name}`;
  const per = st.props.get(cls) || new Map();
  st.props.set(cls, per);
  if (per.has(key)) return per.get(key);
  per.set(key, []);
  const sources = [decl.value, ...propertyAssignments(cls, name, isStatic)].filter(Boolean);
  const why = sources.flatMap((source) => st.classify(source, fresh(env), st));
  const result = why.length > 0 ? [`prop:${text}>${why[0]}`] : [];
  per.set(key, result);
  return result;
}

export function ownClassOf(lookup) {
  const cls = enclosingClass(lookup);
  const ref = lookup.what;
  if (isOwnClassRef(ref, cls)) return cls;
  return ref.kind === 'name' ? findClassNamed(rootOf(lookup), ref.name) : null;
}

/** `$this->prop`: safe for $wpdb properties and *table* properties; else judged by the class's own writes. */
export function propertyReasons(e, env, st) {
  const text = textOf(e);
  const isSafeText = WPDB_PROPERTY.test(text) || TABLE_PROPERTY.test(text);
  if (isSafeText) return [];
  const isVariable = e.what.kind === 'variable' && e.offset.kind === 'identifier';
  if (!isVariable) return [`prop:${text}`];
  const isThisMember = e.what.name === 'this';
  if (isThisMember) return memberReasons(enclosingClass(e), e.offset.name, false, text, env, st);
  return st.classify(e.what, env, st).length > 0 ? [`prop:${text}`] : [];
}

/** `C::CONST` is safe; `self::$prop` is judged by the class's own writes. */
export function staticReasons(e, env, st) {
  const isConstant = e.offset.kind === 'identifier';
  if (isConstant) return [];
  const isVariable = e.offset.kind === 'variable' && typeof e.offset.name === 'string';
  const cls = isVariable ? ownClassOf(e) : null;
  return cls ? memberReasons(cls, e.offset.name, true, textOf(e), env, st) : [`static:${textOf(e)}`];
}

// ---- parameters ---------------------------------------------------------------------------

function otherFileSites(method, cls, st) {
  const index = st.ctx.index;
  const clsName = classNameOf(cls);
  const isBlind = !index || !clsName;
  if (isBlind) return [];
  const lower = method.toLowerCase();
  const mentions = (rel) => {
    const facts = index.facts(rel);
    return Boolean(facts) && facts.functions.some((f) => f.calls.some((c) => String(c.name).toLowerCase() === lower));
  };
  return index.files().filter(mentions).flatMap((rel) => staticSites(link(st, index.loadAst(rel)), lower, clsName));
}

function sitesOf(scope, cls, st) {
  const method = nameOfMethod(scope);
  const own = callSites(cls, method.toLowerCase(), cls);
  return scope.visibility === 'private' ? own : [...own, ...otherFileSites(method, cls, st)];
}

function argumentReasons(site, index, scope, st) {
  const arg = site.arguments[index];
  const param = scope.arguments[index];
  if (!arg) return param && param.value ? st.classify(param.value, ROOT_ENV, st) : [];
  return arg.kind === 'variadic' ? ['spread'] : st.classify(arg, ROOT_ENV, st);
}

function computeSiteReasons(scope, name, st) {
  const unsafe = [`param:$${name}`];
  const cls = enclosingClass(scope);
  const isInternal = scope.kind === 'method' && Boolean(cls) && (scope.visibility === 'private' || scope.isStatic === true);
  if (!isInternal) return unsafe;
  const index = scope.arguments.findIndex((p) => nameOfParam(p) === name);
  const sites = index < 0 ? [] : sitesOf(scope, cls, st);
  const isUnseen = sites.length === 0;
  if (isUnseen) return unsafe;
  const why = sites.flatMap((site) => argumentReasons(site, index, scope, st));
  return why.length > 0 ? [`param:$${name}>${why[0]}`] : [];
}

/**
 * A parameter of a private or static method is safe when every call site the index can see passes a safe
 * value. Public instance methods and plain functions are unsafe: callers outside the index are unknown.
 */
export function siteReasons(scope, name, st) {
  const per = st.sites.get(scope) || new Map();
  st.sites.set(scope, per);
  if (per.has(name)) return per.get(name);
  per.set(name, []);
  const result = computeSiteReasons(scope, name, st);
  per.set(name, result);
  return result;
}
