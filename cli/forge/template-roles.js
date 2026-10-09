// Structural ROLE tokens of a tmpl unit (engine doc section 7, Template refinement). fp3 erases every
// static attribute value, so the roles are read back from the member file: the template is parsed again
// (once per file per run) and the unit's element is found by its preorder nodeId, which
// collectTemplateUnits assigns per root set, and its start line.
//   structural  a static `variant`, `as` or `type` whose value is a ROLE token, and every slot name, on an
//               element below the unit's root. Different structural roles mean different structure.
//   not here    roles on the root element and on other attributes (tone, size): those may be holes.
// The role key lists each structural role with its child-index trail, in preorder.
import { isSfcFile, parseSfc } from '../sfc/sfc-parse.js';
import { parseScriptAsts } from '../sfc/script-asts.js';
import { vueRootElements } from './template-normalize.js';
import { jsxRootElements, ROLE_PATTERN } from './template-units.js';

export const STRUCTURAL_ROLE_ATTRS = new Set(['variant', 'as', 'type']);

const isElement = (node) => node.type === 'El';

/** Elements of one root set with the preorder ids collectTemplateUnits gives them. */
const numberElements = (roots) => {
  const numbered = [];
  let nextId = 0;
  const visit = (element) => {
    nextId += 1;
    numbered.push({ nodeId: nextId, element });
    element.children.filter(isElement).forEach(visit);
  };
  roots.forEach(visit);
  return numbered;
};

const rootSetsOf = (relativePath, content) => {
  const isSfc = isSfcFile(relativePath);
  const sfc = isSfc ? parseSfc(content, relativePath) : null;
  const hasTemplate = Boolean(sfc?.template?.isParsed);
  if (isSfc) return hasTemplate ? [vueRootElements(sfc.template.ast)] : [];
  return parseScriptAsts(content, null, content).asts.map((ast) => jsxRootElements(ast, content));
};

const isStructuralAttr = (attr) => {
  const isRoleAttr = attr.kind === 'static' && STRUCTURAL_ROLE_ATTRS.has(attr.name) && ROLE_PATTERN.test(attr.value);
  return isRoleAttr || attr.kind === 'slot';
};

const rolesOf = (element) => element.attrs.filter(isStructuralAttr).map((attr) => (attr.kind === 'slot' ? `slot=${attr.name}` : `${attr.name}=${attr.value}`));

/** The structural role key below an element's root: `trail:role` entries in preorder, ';'-joined. */
export const structuralRoleKey = (element) => {
  const entries = [];
  const visit = (node, trail) => {
    node.children.filter(isElement).forEach((child, index) => {
      const childTrail = `${trail}.${index}`;
      entries.push(...rolesOf(child).map((role) => `${childTrail}:${role}`));
      visit(child, childTrail);
    });
  };
  visit(element, '');
  return entries.join(';');
};

const unresolvedKeyOf = (row) => `?${row.file_path}:${row.start_line}`;

/**
 * Role reader over file contents: readFile(relativePath) returns the text or null. roleKeyOf(row) gives
 * the row's structural role key, or a '?'-prefixed key of its own when its element cannot be found (the
 * file changed or failed to parse), so an unresolved member never joins any partition.
 */
export const createRoleReader = (readFile) => {
  const elementsByFile = new Map();

  const elementsOf = (relativePath) => {
    const isCached = elementsByFile.has(relativePath);
    if (isCached) return elementsByFile.get(relativePath);
    const content = readFile(relativePath);
    const elements = content === null ? [] : rootSetsOf(relativePath, content).flatMap(numberElements);
    elementsByFile.set(relativePath, elements);
    return elements;
  };

  const roleKeyOf = (row) => {
    const nodeId = row.nodeId ?? null;
    const found = elementsOf(row.file_path).find((entry) => entry.nodeId === nodeId && entry.element.loc.start === row.start_line);
    return found ? structuralRoleKey(found.element) : unresolvedKeyOf(row);
  };

  return { roleKeyOf };
};
