// Placement of a Forge piece (engine doc, HOLES AND NEEDS and ranking's placementOk): which kind of
// blueprint a group becomes for its facet, and the module that hosts the piece.
//   Kind table: a facet only gets the kinds its language and runtime can carry. A Vue composable needs a
//   vue facet whose unit calls Vue's composition API; a React hook needs a react facet whose unit calls
//   React hooks; a component needs a template group in a vue, react or svelte facet. Plain facets (the
//   whole of cli/**) only ever get extract-function, tabulate or reuse, in a module of their own
//   extension family.
//   Host: the existing same-package module that already holds the most instances of the idiom (members
//   and drift spans, at least 2), else the matched library piece's default module, else a new module in
//   the members' deepest common directory. Members and host must share one package root.
import path from 'node:path';
import { sharedAnchors, byCodePoint } from './group-shape.js';
import { isSpecPath, packageRootOfKey } from './facets.js';
import { kebabOf, pascalOf, tokensOf, camelOf } from './naming.js';

const SCRIPT_FAMILIES = [
  { family: 'js', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  { family: 'ts', extensions: ['.ts', '.mts', '.cts', '.tsx'] }
];
const COMPONENT_EXTENSIONS = { vue: '.vue', svelte: '.svelte', react: { ts: '.tsx', js: '.jsx' } };
const FRAMEWORK_CALLS = {
  vue: new Set(['computed', 'getCurrentScope', 'inject', 'onBeforeUnmount', 'onMounted', 'onScopeDispose', 'onUnmounted', 'provide', 'reactive', 'ref', 'shallowRef', 'toRef', 'toRefs', 'watch', 'watchEffect']),
  react: new Set(['useCallback', 'useContext', 'useEffect', 'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState'])
};
const FRAMEWORK_MODULES = { vue: /^vue$/, react: /^react$/ };
const MIN_HOST_HITS = 2;

/** Runtime of a facet key (`js:plain:src:.` -> plain). */
export const runtimeOfKey = (facetKey) => facetKey.split(':')[1] ?? 'plain';

/** Language of a facet key. */
export const langOfKey = (facetKey) => facetKey.split(':')[0] ?? 'js';

const extensionOf = (file) => path.posix.extname(file);

const familyOfFile = (file) => SCRIPT_FAMILIES.find((entry) => entry.extensions.includes(extensionOf(file)))?.family ?? null;

/** True when an anchor is a call of one of the facet runtime's framework APIs (a hook or composition call). */
export const callsFrameworkApi = (anchors, runtime) => {
  const names = FRAMEWORK_CALLS[runtime];
  const modulePattern = FRAMEWORK_MODULES[runtime];
  if (!names) return false;
  return anchors.some((anchor) => {
    const imported = /^import:([^#]+)#(.+)$/.exec(anchor);
    const isImport = imported !== null && modulePattern.test(imported[1]) && names.has(imported[2]);
    const isCall = anchor.startsWith('call:') && names.has(anchor.slice(5));
    return isImport || isCall;
  });
};

const hookKindOf = (runtime) => ({ vue: 'extract-composable', react: 'extract-hook' })[runtime] ?? null;

/**
 * The blueprint kind of a group: component for a template group in a framework facet, a composable or hook
 * only when the unit calls that framework's APIs, tabulate for W, advisory when no placement exists, else
 * extract-function (reuse when the matched library piece already lives in the project).
 */
export const kindOf = ({ group, facetKey, placementOk = true, libraryExists = false }) => {
  const runtime = runtimeOfKey(facetKey);
  const anchors = sharedAnchors(group.instances);
  const isTemplate = group.kind === 'tmpl';
  const hasComponentHome = runtime in COMPONENT_EXTENSIONS;
  if (!placementOk) return 'advisory';
  if (isTemplate) return hasComponentHome ? 'extract-component' : 'advisory';
  const hookKind = hookKindOf(runtime);
  const isHook = hookKind !== null && callsFrameworkApi(anchors, runtime);
  const isTable = group.path === 'W';
  if (isHook) return hookKind;
  if (isTable) return 'tabulate';
  return libraryExists ? 'reuse' : 'extract-function';
};

const commonDirOf = (files) => {
  const parts = files.map((file) => path.posix.dirname(file).split('/').filter((part) => part !== '.'));
  const shared = [];
  for (let index = 0; index < Math.min(...parts.map((list) => list.length)); index += 1) {
    const segment = parts[0][index];
    const isShared = parts.every((list) => list[index] === segment);
    if (!isShared) break;
    shared.push(segment);
  }
  return shared.join('/');
};

const joinPath = (dir, file) => (dir === '' ? file : `${dir}/${file}`);

// A component file (.vue, .svelte) never hosts a plain function: its script extension is that of the facet lang.
const COMPONENT_EXTENSION_SET = new Set(['.vue', '.svelte']);
const LANG_EXTENSIONS = { ts: '.ts', js: '.js' };

const scriptExtensionOf = (files, lang = 'js') => {
  const counts = new Map();
  for (const file of files) {
    const own = extensionOf(file);
    const extension = COMPONENT_EXTENSION_SET.has(own) ? (LANG_EXTENSIONS[lang] ?? '.js') : own;
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || byCodePoint(a, b))[0][0];
};

const hostHitsOf = (group) => {
  const counts = new Map();
  for (const span of [...group.instances, ...(group.drift ?? [])]) counts.set(span.file, (counts.get(span.file) ?? 0) + 1);
  return counts;
};

const isCompatibleHost = (file, family, context) => {
  const isSameFamily = familyOfFile(file) === family;
  return isSameFamily && !isSpecPath(file) && context.fileExists(file);
};

const hostOf = (group, family, packageRoot, context) => {
  const ranked = [...hostHitsOf(group)]
    .filter(([file, hits]) => hits >= MIN_HOST_HITS && context.packageRootOfFile(file) === packageRoot && isCompatibleHost(file, family, context))
    .sort(([a, x], [b, y]) => y - x || byCodePoint(a, b));
  return ranked.length > 0 ? ranked[0][0] : null;
};

const componentModule = (dir, name, lang, runtime) => {
  const tokens = tokensOf(name);
  const extension = runtime === 'react' ? COMPONENT_EXTENSIONS.react[lang] : COMPONENT_EXTENSIONS[runtime];
  const stem = `m-${kebabOf(tokens.filter((token) => token !== 'm'))}`;
  return joinPath(dir, `${stem}/${stem}${extension}`);
};

const newModuleOf = ({ kind, name, dir, files, lang, runtime }) => {
  const isComponent = kind === 'extract-component';
  if (isComponent) return componentModule(dir, name, lang, runtime);
  const stem = kind === 'extract-composable' || kind === 'extract-hook' ? camelOf(tokensOf(name)) : kebabOf(tokensOf(name));
  return joinPath(dir, `${stem}${scriptExtensionOf(files, lang)}`);
};

/** The `use` name a composable or hook must carry. */
export const hookNameOf = (name) => {
  const tokens = tokensOf(name);
  return tokens[0] === 'use' ? name : `use${pascalOf(tokens)}`;
};

/**
 * Where the piece lives. input: { group, kind, name, library: { defaultModule } | null }, context:
 * { fileExists(relative), packageRootOfFile(relative) }.
 * Returns { ok, reason, module, moduleIsNew, source: host|library|new|none, packageRoot, dir }.
 */
export const placeGroup = ({ group, kind, name, library = null }, context) => {
  const files = [...new Set(group.instances.map((instance) => instance.file))].sort(byCodePoint);
  const roots = new Set(files.map((file) => context.packageRootOfFile(file)));
  const isOneRoot = roots.size === 1;
  const packageRoot = [...roots].sort(byCodePoint)[0];
  if (!isOneRoot) return { ok: false, reason: `members span ${roots.size} package roots`, module: null, moduleIsNew: false, source: 'none', packageRoot: null, dir: '' };
  const lang = langOfKey(group.facetKey);
  const runtime = runtimeOfKey(group.facetKey);
  const family = familyOfFile(files[0]);
  const dir = commonDirOf(files);
  const isScript = kind !== 'extract-component';
  const host = isScript && family ? hostOf(group, family, packageRoot, context) : null;
  const libraryModule = library?.defaultModule ?? null;
  const isLibraryUsable = libraryModule !== null && familyOfFile(libraryModule) === family && context.packageRootOfFile(libraryModule) === packageRoot;
  if (host) return { ok: true, reason: 'host module holds the idiom', module: host, moduleIsNew: false, source: 'host', packageRoot, dir };
  if (isLibraryUsable) return { ok: true, reason: 'library default module', module: libraryModule, moduleIsNew: !context.fileExists(libraryModule), source: 'library', packageRoot, dir };
  const module = newModuleOf({ kind, name, dir, files, lang, runtime });
  return { ok: true, reason: 'new module in the members\' common directory', module, moduleIsNew: !context.fileExists(module), source: 'new', packageRoot, dir };
};

/** The package root of a group's facet key (all members share one facet). */
export const packageRootOfGroup = (group) => packageRootOfKey(group.facetKey);
