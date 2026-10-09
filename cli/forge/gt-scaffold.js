// Scaffolds for the ground-truth sandbox (gt-sandbox.js). A script excerpt that starts indented was cut
// from inside a function (statements, a try, a nested const). At the top level it is no unit at all
// (Program statements are not stmt units) or does not parse (`return` outside a function). A run of such
// regions (overlapping or adjacent excerpts, all indented, with no top-level excerpt between them: in
// the real file they share an enclosing function or sit close to it) gets one scaffold on the free lines
// around it: `async function gtScaffold<line>(<names>) {` before and `}` after, so excerpts of one block
// stay siblings of one block. The excerpt lines stay verbatim and at their labeled lines; a run without
// free lines around it is left as it is.
// <names> binds what the real enclosing scope bound: every identifier the run reads or writes without
// declaring it, except real globals (globalThis, the browser's), Node builtin module names (path, fs:
// imports in the real file) and SCREAMING_CASE module constants (DISCUSSION_CATEGORY_SLUG: imported).
// Unbound, a loop variable like `arg` would hash as a global anchor, which it never is in the real file.
// A called name (fetchAttention, spawnSync) may be a file-level function or an import; it is bound, so
// the sandbox never claims evidence the excerpt does not show.
import { builtinModules } from 'node:module';
import { parse, traverse } from '../babel-lazy.js';
import { SCRIPT_PARSE_OPTIONS } from '../sfc/script-asts.js';

const INDENTED = /^\s/;
const SCAFFOLD_NAME = /^gtScaffold\d+$/;
const BROWSER_GLOBALS = new Set(['document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'location', 'history', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle']);
const MODULE_NAMES = new Set(builtinModules.filter((name) => !name.includes('/')).map((name) => name.replace(/^node:/, '').replace(/[^\w$]/g, '_')));

const MODULE_CONSTANT = /^[A-Z][A-Z0-9_]+$/;

const isRealGlobal = (name) => name in globalThis || BROWSER_GLOBALS.has(name);

const isModuleLevel = (name) => MODULE_NAMES.has(name) || MODULE_CONSTANT.test(name);

// Regions of overlapping or adjacent excerpts, in line order: { startLine, endLine, isIndented }.
const regionsOf = (excerpts) => {
  const regions = [];
  const ordered = [...excerpts].sort((a, b) => a.startLine - b.startLine);
  for (const excerpt of ordered) {
    const endLine = excerpt.startLine + excerpt.lines.length - 1;
    const isIndented = INDENTED.test(excerpt.lines.find((line) => line.trim() !== '') ?? '');
    const last = regions.at(-1);
    const isJoined = Boolean(last) && excerpt.startLine <= last.endLine + 1;
    if (isJoined) Object.assign(last, { endLine: Math.max(last.endLine, endLine), isIndented: last.isIndented && isIndented });
    if (!isJoined) regions.push({ startLine: excerpt.startLine, endLine, isIndented });
  }
  return regions;
};

// Consecutive indented regions, split at every top-level one: [{ startLine, endLine }].
const indentedRuns = (regions) => {
  const runs = [];
  let current = null;
  for (const region of regions) {
    const isBreak = !region.isIndented;
    if (isBreak) current = null;
    if (isBreak) continue;
    const isFirst = current === null;
    if (isFirst) current = { startLine: region.startLine, endLine: region.endLine };
    if (isFirst) runs.push(current);
    current.endLine = region.endLine;
  }
  return runs;
};

const isFreeName = (nodePath) => {
  const { name } = nodePath.node;
  const isBound = nodePath.scope.hasBinding(name, true);
  const isTarget = nodePath.parentPath.isAssignmentExpression({ left: nodePath.node }) || nodePath.parentPath.isUpdateExpression();
  const isUsed = nodePath.isReferencedIdentifier() || isTarget;
  return isUsed && !isBound && !isRealGlobal(name) && !isModuleLevel(name);
};

// Free names per scaffold: Map(opener line index -> sorted names).
const freeNamesOf = (text) => {
  const names = new Map();
  const ast = parse(text, SCRIPT_PARSE_OPTIONS);
  traverse(ast, {
    FunctionDeclaration(fnPath) {
      const isScaffold = SCAFFOLD_NAME.test(fnPath.node.id?.name ?? '');
      if (!isScaffold) return;
      const free = new Set();
      fnPath.traverse({ Identifier: (nodePath) => { if (isFreeName(nodePath)) free.add(nodePath.node.name); } });
      names.set(fnPath.node.loc.start.line - 1, [...free].sort());
    }
  });
  return names;
};

const openerOf = (startLine, names) => `async function gtScaffold${startLine}(${names.join(', ')}) {`;

const bindFreeNames = (lines, openers) => {
  try {
    const names = freeNamesOf(Array.from(lines, (line) => line ?? '').join('\n'));
    for (const [index, startLine] of openers) lines[index] = openerOf(startLine, names.get(index) ?? []);
  } catch {
    return lines;
  }
  return lines;
};

/** Script lines (sparse array, excerpt lines in place) with scaffolds added where they fit. */
export const scaffoldScript = (lines, excerpts) => {
  const openers = new Map();
  for (const run of indentedRuns(regionsOf(excerpts))) {
    const opener = run.startLine - 2;
    const closer = run.endLine;
    const isRoomy = opener >= 0 && lines[opener] === undefined && lines[closer] === undefined;
    if (!isRoomy) continue;
    lines[opener] = openerOf(run.startLine, []);
    lines[closer] = '}';
    openers.set(opener, run.startLine);
  }
  return openers.size > 0 ? bindFreeNames(lines, openers) : lines;
};
