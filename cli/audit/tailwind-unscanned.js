/**
 * TAILWIND_UNSCANNED_CLASS_STRING (ruleset 6, Pillar 5). A Tailwind v3 build only emits the utilities it finds
 * in files matched by the `content` globs of tailwind.config. A lookup map of class strings that moved from a
 * template into a `.ts` file outside those globs passes every other gate and is purged from production CSS.
 *
 * chemx cannot run Tailwind and never imports its config (it may be TypeScript or have side effects), so the
 * config is read as text and each script file's project-relative path is compared with the globs. The rule is
 * silent unless Tailwind v3 is declared, a tailwind.config.{js,cjs,mjs,ts} sits at the project root and its
 * `content` list is made of string literals only. Tailwind v4 (automatic source detection) and dynamic content
 * lists such as `content: [...shared]` stay silent, because the glob list would be incomplete.
 *
 * options.tailwindContent overrides the config: an array of globs, or null to force silence.
 */
import fs from 'node:fs';
import path from 'node:path';
import traverse from '@babel/traverse';
import { RULE_REGISTRY } from './rules-registry.js';
import { globToRegExp } from './line-budgets.js';
import { detectStylingStack } from '../project-detector.js';
import { readJsonOr } from '../fs-json.js';

const traverseFn = traverse.default || traverse;

/**
 * Tailwind utility shapes, matched per whitespace-separated token (a leading `!` or `-` is ignored).
 * keywords: the whole token, or the keyword followed by `-<more>` (flex, flex-col, border, border-b).
 * prefixes: the token starts with the prefix and carries at least one more character (px-4, text-sm).
 * variants: a variant prefix followed by a utility (md:flex, hover:bg-gold).
 */
export const TAILWIND_UTILITY_SHAPES = Object.freeze({
  keywords: Object.freeze([
    'flex', 'grid', 'block', 'inline', 'hidden', 'border', 'rounded', 'shadow', 'ring', 'absolute', 'relative',
    'fixed', 'sticky', 'transition', 'truncate'
  ]),
  prefixes: Object.freeze([
    'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-', 'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-', 'w-', 'h-',
    'min-', 'max-', 'text-', 'bg-', 'gap-', 'items-', 'justify-', 'space-', 'font-', 'opacity-', 'z-', 'inset-',
    'top-', 'left-', 'right-', 'bottom-', 'overflow-', 'duration-', 'translate-', 'rotate-', 'scale-', 'cursor-',
    'select-', 'leading-', 'tracking-', 'col-', 'row-', 'order-'
  ]),
  variants: Object.freeze(['sm:', 'md:', 'lg:', 'xl:', '2xl:', 'hover:', 'focus:', 'dark:', 'group-hover:'])
});

const MIN_TOKENS = 3;
const MIN_UTILITY_TOKENS = 2;
const PREVIEW_LENGTH = 40;
const SCRIPT_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs']);
// Never shipped to the browser, so Tailwind has no reason to scan them: tests, test dirs and tool configs.
const NON_BUNDLED_PATH = /\.(?:test|spec|config)\.[cm]?[jt]s$|(?:^|\/)(?:tests?|__tests__)\//;
const CONFIG_NAMES = ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts'];
// Tailwind v4 ships its integrations as @tailwindcss/* packages and auto-detects sources, so `content` is moot.
const TAILWIND_V4_PACKAGES = ['@tailwindcss/vite', '@tailwindcss/postcss', '@tailwindcss/cli'];
const QUOTES = new Set(["'", '"', '`']);
const COMMENT_CLOSERS = { '//': '\n', '/*': '*/' };
const OPENERS = '[{(';
const CLOSERS = ']})';
const SEPARATOR = /[\s,]/;
const CONTENT_KEY = /\bcontent['"]?\s*:\s*([[{])/g;
const FILES_KEY = /\bfiles['"]?\s*:\s*\[/;

const matchesKeyword = (token, keyword) => token === keyword || token.startsWith(`${keyword}-`);
const matchesPrefix = (token, prefix) => token.length > prefix.length && token.startsWith(prefix);

/** True when one class token has a Tailwind utility shape. */
export const isUtilityToken = (token) => {
  const bare = token.replace(/^[!-]+/, '');
  const { keywords, prefixes, variants } = TAILWIND_UTILITY_SHAPES;
  const isKeyword = keywords.some((keyword) => matchesKeyword(bare, keyword));
  const isPrefixed = [...prefixes, ...variants].some((prefix) => matchesPrefix(bare, prefix));
  return isKeyword || isPrefixed;
};

/** True when text is 3+ whitespace-separated tokens of which at least 2 have a utility shape. */
export const isUtilityClassString = (text) => {
  const tokens = text.trim().split(/\s+/);
  const hasEnoughTokens = tokens.length >= MIN_TOKENS;
  return hasEnoughTokens && tokens.filter(isUtilityToken).length >= MIN_UTILITY_TOKENS;
};

const skipString = (text, start) => {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const isClosingQuote = text[i] === quote;
    if (isClosingQuote) return i + 1;
    i += text[i] === '\\' ? 2 : 1;
  }
  return text.length;
};

/** Index just past the comment that starts at `start`, or `start` itself when no comment starts there. */
const skipComment = (text, start) => {
  const closer = COMMENT_CLOSERS[text.slice(start, start + 2)];
  if (!closer) return start;
  const closeAt = text.indexOf(closer, start + 2);
  const isLineComment = closer === '\n';
  return closeAt === -1 ? text.length : closeAt + (isLineComment ? 0 : closer.length);
};

/** Replaces comments with a space and keeps string contents, so a pattern never matches inside a comment. */
const blankComments = (text) => {
  let blanked = '';
  let i = 0;
  while (i < text.length) {
    const isString = QUOTES.has(text[i]);
    const commentEnd = isString ? i : skipComment(text, i);
    const isComment = commentEnd > i;
    const stringEnd = isString ? skipString(text, i) : i + 1;
    blanked += isComment ? ' ' : text.slice(i, stringEnd);
    i = isComment ? commentEnd : stringEnd;
  }
  return blanked;
};

/** The text between the bracket opened at openIndex and its match; strings are skipped whole. */
const readBracketBody = (text, openIndex) => {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const isString = QUOTES.has(text[i]);
    depth += !isString && OPENERS.includes(text[i]) ? 1 : 0;
    depth -= !isString && CLOSERS.includes(text[i]) ? 1 : 0;
    const isClosed = depth === 0;
    if (isClosed) return text.slice(openIndex + 1, i);
    i = isString ? skipString(text, i) : i + 1;
  }
  return text.slice(openIndex + 1);
};

/** One entry of a content list: a separator, a static string (glob), a `{ raw }` object, or dynamic code. */
const readListEntry = (body, i) => {
  const isString = QUOTES.has(body[i]);
  const stringEnd = isString ? skipString(body, i) : i + 1;
  const literal = body.slice(i + 1, stringEnd - 1);
  const handlers = [
    [SEPARATOR.test(body[i]), () => ({ next: i + 1 })],
    [isString && !literal.includes('${'), () => ({ next: stringEnd, glob: literal })],
    [body[i] === '{', () => ({ next: i + readBracketBody(body, i).length + 2 })]
  ];
  const handler = handlers.find(([isApplicable]) => isApplicable);
  return handler ? handler[1]() : { next: i + 1, isDynamic: true };
};

/** String literals of a list body; [] when an entry is a spread, identifier or call (the list is not fully static). */
const readGlobList = (body) => {
  const globs = [];
  let i = 0;
  while (i < body.length) {
    const entry = readListEntry(body, i);
    if (entry.isDynamic) return [];
    const isGlob = 'glob' in entry;
    if (isGlob) globs.push(entry.glob);
    i = entry.next;
  }
  return globs;
};

const readFilesList = (objectBody) => {
  const files = FILES_KEY.exec(objectBody);
  const openIndex = files ? files.index + files[0].length - 1 : -1;
  return files ? readGlobList(readBracketBody(objectBody, openIndex)) : [];
};

/**
 * Content globs from the text of a tailwind.config: `content: [...]` or `content: { files: [...] }`.
 * Returns [] when there is no content key or the list is not made of string literals.
 */
export const parseTailwindContentGlobs = (configText) => {
  const text = blankComments(String(configText));
  for (const match of text.matchAll(CONTENT_KEY)) {
    const openIndex = match.index + match[0].length - 1;
    const body = readBracketBody(text, openIndex);
    const globs = match[1] === '[' ? readGlobList(body) : readFilesList(body);
    const hasGlobs = globs.length > 0;
    if (hasGlobs) return globs;
  }
  return [];
};

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    // chemx-allow: best-effort a missing or unreadable tailwind config means no readable content globs, so the rule stays silent
    return '';
  }
};

const isTailwindFour = (cwd) => {
  const pkg = readJsonOr(path.resolve(cwd, 'package.json'), {}) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasV4Package = TAILWIND_V4_PACKAGES.some((name) => Boolean(deps[name]));
  const major = Number.parseInt(String(deps.tailwindcss ?? '').replace(/^\D+/, ''), 10);
  return hasV4Package || major >= 4;
};

const readProjectContentGlobs = (cwd) => {
  const isV3Project = detectStylingStack(cwd).hasTailwind && !isTailwindFour(cwd);
  const configs = isV3Project ? CONFIG_NAMES : [];
  for (const name of configs) {
    const globs = parseTailwindContentGlobs(readText(path.resolve(cwd, name)));
    const hasGlobs = globs.length > 0;
    if (hasGlobs) return globs;
  }
  return [];
};

const contentCache = new Map();
const compiledCache = new Map();

/** Content globs of the Tailwind v3 project at cwd, resolved once per cwd; [] when the rule must stay silent. */
export const resolveTailwindContent = (cwd) => {
  const cached = contentCache.get(cwd);
  if (cached) return cached;
  const globs = readProjectContentGlobs(cwd);
  contentCache.set(cwd, globs);
  return globs;
};

export const clearTailwindContentCache = () => {
  contentCache.clear();
  compiledCache.clear();
};

const expandBraces = (glob) => {
  const group = /\{([^{}]*)\}/.exec(glob);
  if (!group) return [glob];
  const before = glob.slice(0, group.index);
  const after = glob.slice(group.index + group[0].length);
  return group[1].split(',').flatMap((option) => expandBraces(`${before}${option}${after}`));
};

const normalizeGlob = (glob) => glob.trim().replace(/^\.\//, '');

/** { include, exclude } RegExp lists for content globs; `!glob` entries exclude and `{a,b}` braces expand. */
const compileContentGlobs = (globs) => {
  const key = globs.join('\n');
  const cached = compiledCache.get(key);
  if (cached) return cached;
  const compiled = { include: [], exclude: [] };
  for (const raw of globs) {
    const isNegated = raw.startsWith('!');
    const patterns = expandBraces(normalizeGlob(isNegated ? raw.slice(1) : raw)).map(globToRegExp);
    compiled[isNegated ? 'exclude' : 'include'].push(...patterns);
  }
  compiledCache.set(key, compiled);
  return compiled;
};

// globToRegExp matches at any directory depth; a Tailwind glob is rooted at the project, so the match must start at 0.
const matchesFromRoot = (regex, projectPath) => regex.exec(projectPath)?.index === 0;

/** True when Tailwind scans projectPath (project-relative, forward slashes) under the compiled content globs. */
const isScannedByTailwind = (projectPath, { include, exclude }) => {
  const isIncluded = include.some((regex) => matchesFromRoot(regex, projectPath));
  const isExcluded = exclude.some((regex) => matchesFromRoot(regex, projectPath));
  return isIncluded && !isExcluded;
};

const toSlashes = (value) => String(value).replace(/\\/g, '/');

// The audit scan passes the absolute file path with the root-relative one; what precedes the latter is the root.
const deriveRoot = (filePath, relativePath) => {
  const file = toSlashes(filePath);
  const relative = toSlashes(relativePath).replace(/^\.\//, '');
  const isDerivable = path.isAbsolute(filePath) && file.endsWith(`/${relative}`);
  return isDerivable ? file.slice(0, file.length - relative.length - 1) || '/' : null;
};

const resolveProjectRoot = (filePath, relativePath, options) => options.cwd || deriveRoot(filePath, relativePath) || process.cwd();

const toProjectPath = (relativePath, root) => {
  const projectPath = path.isAbsolute(relativePath) ? path.relative(root, relativePath) : relativePath;
  return toSlashes(projectPath).replace(/^\.\//, '');
};

const isInsideProject = (projectPath) => projectPath !== '' && projectPath !== '..' && !projectPath.startsWith('../');

const resolveGlobs = (root, options) => {
  const hasOverride = options.tailwindContent !== undefined;
  return hasOverride ? options.tailwindContent ?? [] : resolveTailwindContent(root);
};

/** True when the script at relativePath ships to the browser yet no Tailwind content glob covers it. */
export const isUnscannedScript = (filePath, relativePath, options = {}) => {
  const isScript = SCRIPT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
  const root = isScript ? resolveProjectRoot(filePath, relativePath, options) : '';
  const globs = isScript ? resolveGlobs(root, options) : [];
  const projectPath = globs.length > 0 ? toProjectPath(relativePath, root) : '';
  const isBundled = isInsideProject(projectPath) && !NON_BUNDLED_PATH.test(projectPath);
  return isBundled && !isScannedByTailwind(projectPath, compileContentGlobs(globs));
};

const buildViolation = (relativePath, node, text) => {
  const meta = RULE_REGISTRY.TAILWIND_UNSCANNED_CLASS_STRING;
  const preview = text.trim().slice(0, PREVIEW_LENGTH).trimEnd();
  return {
    filePath: relativePath,
    line: node.loc?.start.line || 1,
    column: (node.loc?.start.column ?? 0) + 1,
    hazard: `Tailwind class string in a file the content globs do not scan ("${preview}")`,
    rule: 'TAILWIND_UNSCANNED_CLASS_STRING',
    severity: meta.severity,
    pillar: meta.pillar,
    directive: meta.directive
  };
};

const createClassStringVisitors = (onClassString) => ({
  StringLiteral(astPath) {
    onClassString(astPath.node, astPath.node.value);
  },
  TemplateLiteral(astPath) {
    const { quasis, expressions } = astPath.node;
    const isPlain = expressions.length === 0;
    if (isPlain) onClassString(astPath.node, quasis[0].value.cooked ?? quasis[0].value.raw);
  }
});

/** Reports utility class strings in a script file the Tailwind content globs do not scan. Runs on the parsed ASTs. */
export const runTailwindUnscannedPass = (asts, { filePath, relativePath, violations, options = {} }) => {
  const isUnscanned = isUnscannedScript(filePath, relativePath, options);
  const reportIfClassString = (node, text) => {
    if (isUtilityClassString(text)) violations.push(buildViolation(relativePath, node, text));
  };
  const visitors = createClassStringVisitors(reportIfClassString);
  if (isUnscanned) asts.forEach((ast) => traverseFn(ast, visitors));
};
