// A plain preorder walk of a Babel File that hands each node of a handled type the same facts a Babel
// traverse visitor would read from its NodePath: { node, parent, grandparent, scope } (#5911).
// Babel still crawls the Program once (its scope analysis is the source of truth); the walk then
// reads the Scope objects that crawl cached per node instead of re-traversing with NodePaths, which
// was the larger half of the standalone binding traverse. Order and scope assignment follow
// @babel/traverse 7.x: VISITOR_KEYS order, a node's own Scope when t.isScope(node, parent), else the
// parent path's, and a method's key and decorators and a switch's discriminant see the scope outside
// that node (NodePath#setScope). walkBindingSites returns false, having called handlers for a prefix
// of the tree, when a scopable node has no crawled Scope (the crawl skips TSTypeAnnotation subtrees);
// the caller then falls back to a real traverse. binding-walk.spec.js checks the two agree.
import { lazyTypes, traverse, traverseCache } from '../babel-lazy.js';

let babelTypes = null;
const typesOf = () => {
  babelTypes = babelTypes ?? { VISITOR_KEYS: lazyTypes.VISITOR_KEYS, isScope: lazyTypes.isScope, isMethod: lazyTypes.isMethod };
  return babelTypes;
};

/** Crawls the Program scope through a real traverse that stops at the Program path. */
const crawlProgram = (ast) => {
  let scope = null;
  traverse(ast, {
    Program(programPath) {
      scope = programPath.scope;
      programPath.stop();
    }
  });
  return scope;
};

const OUTER_SCOPE_KEYS = { method: new Set(['key', 'decorators']), SwitchStatement: new Set(['discriminant']) };

const outerKeysOf = (node, isMethod) => {
  if (isMethod(node)) return OUTER_SCOPE_KEYS.method;
  return node.type === 'SwitchStatement' ? OUTER_SCOPE_KEYS.SwitchStatement : null;
};

class MissingScope extends Error {}

/**
 * Walks a Babel File, calling handlers[node.type](site) in traverse order. Returns true when every
 * node was walked, false (no throw) when a scopable node had no crawled Scope. Only a File gets a
 * walk: any other root returns false before calling a handler.
 */
export const walkBindingSites = (ast, handlers) => {
  const isFile = ast?.type === 'File';
  if (!isFile) return false;
  const { VISITOR_KEYS, isScope, isMethod } = typesOf();
  const programScope = crawlProgram(ast);
  if (!programScope) return false;
  const scopes = traverseCache().scope;

  // parentScope: the scope of the parent's NodePath; scope: this node's.
  const visit = (node, parent, grandparent, parentScope) => {
    const scope = isScope(node, parent) ? scopes.get(node) : parentScope;
    if (!scope) throw new MissingScope();
    const handle = handlers[node.type];
    if (handle) handle({ node, parent, grandparent, scope });
    const keys = VISITOR_KEYS[node.type] ?? [];
    const outerKeys = outerKeysOf(node, isMethod);
    for (const key of keys) {
      const value = node[key];
      const childScope = outerKeys?.has(key) ? parentScope : scope;
      const isList = Array.isArray(value);
      if (isList) visitList(value, node, parent, childScope);
      else if (value) visit(value, node, parent, childScope);
    }
  };

  const visitList = (children, parent, grandparent, parentScope) => {
    for (const child of children) {
      if (child) visit(child, parent, grandparent, parentScope);
    }
  };

  try {
    visit(ast.program, ast, null, null);
    return true;
  } catch (err) {
    const isScopeMiss = err instanceof MissingScope;
    if (isScopeMiss) return false;
    throw err;
  }
};
