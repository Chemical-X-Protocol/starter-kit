// tmpl units: Merkle fingerprints of normalized template element subtrees (engine doc section 3,
// Templates). Labels per level:
//   static attr  L1 name=ROLE(v) when v matches ROLE_PATTERN, else name="v"; L2 ROLE kept, other text STR;
//                L3 ATTR(name) (a value hole)
//   :x           L1 BIND(x)=<expr text>; L2 BIND(x) (an EXPR hole); L3 ATTR(x)
//   v-if/for/... L1 IF=<expr>; L2/L3 IF        @e  L1 EVENT(e)=<expr>; L2/L3 EVENT(e)
//   slot         SLOT(name) at every level      children TEXT / INTERP (their text kept only at L1)
// Static attributes are sorted, directives keep their order. At L3 static and bound attributes are
// one sorted ATTR group. mass counts elements, attributes and text/interp children.
import { hash64 } from './murmur.js';
import { normalizeJsxElement, vueRootElements } from './template-normalize.js';
import { traverse } from '../babel-lazy.js';

export const ROLE_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;
export const TMPL_MIN_MASS = 8;

const JSX_ROOT_PARENTS = new Set(['JSXElement', 'JSXFragment']);
const byName = (a, b) => Number(a.name > b.name) - Number(a.name < b.name);

const staticLabels = (attr) => {
  const isRole = ROLE_PATTERN.test(attr.value);
  const l1 = isRole ? `${attr.name}=ROLE(${attr.value})` : `${attr.name}=${JSON.stringify(attr.value)}`;
  return [l1, isRole ? l1 : `${attr.name}=STR`, `ATTR(${attr.name})`];
};

const LABELS = {
  static: staticLabels,
  bind: (attr) => [`BIND(${attr.name})=${attr.exp}`, `BIND(${attr.name})`, `ATTR(${attr.name})`],
  event: (attr) => [`EVENT(${attr.name})=${attr.exp}`, `EVENT(${attr.name})`, `EVENT(${attr.name})`],
  struct: (attr) => [`${attr.name}=${attr.exp}`, attr.name, attr.name],
  slot: (attr) => [`SLOT(${attr.name})`, `SLOT(${attr.name})`, `SLOT(${attr.name})`],
  dir: (attr) => [`DIR(${attr.name})=${attr.exp}`, `DIR(${attr.name})`, `DIR(${attr.name})`]
};

const orderedAttrs = (attrs, level) => {
  const isValueAttr = (attr) => attr.kind === 'static' || (level === 2 && attr.kind === 'bind');
  const sorted = attrs.filter(isValueAttr).sort(byName);
  return [...sorted, ...attrs.filter((attr) => !isValueAttr(attr))];
};

const LEAF_LABELS = {
  Text: (node) => [`TEXT:${node.text}`, 'TEXT', 'TEXT'],
  Interp: (node) => [`INTERP:${node.exp}`, 'INTERP', 'INTERP']
};

/** Fingerprints one normalized element subtree: { fp1, fp2, fp3, mass, anchors: [] }. */
export const hashTemplate = (element) => {
  let mass = 0;
  const walk = (node) => {
    mass += 1;
    const leaf = LEAF_LABELS[node.type];
    if (leaf) return leaf(node).map((label) => hash64(`${node.type}|${label}`));
    mass += node.attrs.length;
    const children = node.children.map(walk);
    return [0, 1, 2].map((level) => {
      const attrs = orderedAttrs(node.attrs, level).map((attr) => LABELS[attr.kind](attr)[level]);
      const kids = children.map((hashes) => hashes[level]);
      return hash64(`El|${node.tag}|${attrs.join(';')}|${kids.join(',')}`);
    });
  };
  const [fp1, fp2, fp3] = walk(element);
  return { fp1, fp2, fp3, mass, anchors: [] };
};

/**
 * tmpl units for a list of root elements: every element subtree with mass >= minMass, with nodeId
 * (preorder), parentId (null at the roots) and ordinal among its element siblings.
 */
export const collectTemplateUnits = (roots, { minMass = TMPL_MIN_MASS } = {}) => {
  const units = [];
  let nextId = 0;
  const visit = (element, parentId, ordinal) => {
    nextId += 1;
    const nodeId = nextId;
    const hashed = hashTemplate(element);
    const isKept = hashed.mass >= minMass;
    if (isKept) units.push({ kind: 'tmpl', start: element.loc.start, end: element.loc.end, tag: element.tag, nodeId, parentId, ordinal, ...hashed });
    element.children.filter((child) => child.type === 'El').forEach((child, index) => visit(child, nodeId, index));
  };
  roots.forEach((root, index) => visit(root, null, index));
  return units;
};

/** tmpl units of a Vue SFC template AST (sfc.template.ast). */
export const collectVueTemplateUnits = (templateAst, options) => collectTemplateUnits(vueRootElements(templateAst), options);

/** tmpl units of the outermost JSX elements in a Babel AST; source is the parsed code. */
export const collectJsxTemplateUnits = (ast, source, options) => {
  const roots = [];
  const collectRoot = (path) => {
    const isNested = JSX_ROOT_PARENTS.has(path.parent.type);
    if (!isNested) roots.push(normalizeJsxElement(path.node, source));
  };
  traverse(ast, { JSXElement: collectRoot, JSXFragment: collectRoot });
  return collectTemplateUnits(roots, options);
};
