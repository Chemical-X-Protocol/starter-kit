// Decide whether a shell word names a file inside the project. Only those reads and writes are
// routed through chemx; data, logs, temp files, scratch dirs and anything outside the repo stay free.

import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx', '.vue', '.svelte', '.scss', '.php']);
const WRITE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.md', '.mdx', '.json', '.yml', '.yaml', '.toml', '.html', '.css']);
// Directories below the root that are never routed: vendored, generated, config and scratch space.
const FREE_SEGMENTS = ['/node_modules/', '/.git/', '/dist/', '/.chemx/', '/.claude/', '/tmp/', '/scratch/', '/.scratch/'];
const UNRESOLVED_VARIABLE = /\$(?!HOME\b|PWD\b|CLAUDE_PROJECT_DIR\b|\{HOME\}|\{PWD\}|\{CLAUDE_PROJECT_DIR\})/;

const expandKnownVariables = (word, { cwd, root }) => word
  .replace(/^~(?=\/|$)/, process.env.HOME ?? '~')
  .replace(/\$\{?HOME\}?/g, process.env.HOME ?? '')
  .replace(/\$\{?PWD\}?/g, cwd)
  .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root);

export const isInsideDirectory = (target, directory) => {
  const relative = path.relative(directory, target);
  const isOutside = relative.startsWith('..') || path.isAbsolute(relative);
  return !isOutside;
};

export const isFreeLocation = (absolute, { root, scratchDir }) => {
  const relative = `/${path.relative(root, absolute)}/`;
  const isFreeSegment = FREE_SEGMENTS.some((segment) => relative.includes(segment));
  const isScratch = Boolean(scratchDir) && isInsideDirectory(absolute, scratchDir);
  return isFreeSegment || isScratch;
};

// The context a command runs in: the payload cwd moved by the literal `cd` words that preceded it
// (shell-parse records them as command.dir). A cd target that is a variable, substitution or `cd -`
// makes the directory unknown; `cwdUnknown` then lets every relative path fail open.
export const contextForCommand = (context, dir) => {
  const steps = dir?.steps ?? [];
  let cwd = context.cwd;
  let cwdUnknown = Boolean(dir?.unknown) || Boolean(context.cwdUnknown);
  for (const step of steps) {
    const isUnresolved = UNRESOLVED_VARIABLE.test(step) || step.includes('`');
    if (isUnresolved) { cwdUnknown = true; break; }
    cwd = path.resolve(cwd, expandKnownVariables(step, { cwd, root: context.root }));
  }
  return { ...context, cwd, cwdUnknown };
};

// Absolute path of a shell word inside the project and outside free locations, else null.
const repoPathOf = (word, context) => {
  const hasUnknownVariable = UNRESOLVED_VARIABLE.test(word);
  if (hasUnknownVariable) return null;
  const expanded = expandKnownVariables(word, context);
  const isRelativeToUnknown = context.cwdUnknown && (!path.isAbsolute(expanded) || /\$\{?PWD/.test(word));
  if (isRelativeToUnknown) return null;
  const absolute = path.resolve(context.cwd, expanded);
  const isRouted = isInsideDirectory(absolute, context.root) && !isFreeLocation(absolute, context);
  return isRouted ? absolute : null;
};

const isRepoFileWithExtension = (word, context, extensions) => {
  const absolute = repoPathOf(word, context);
  return absolute !== null && extensions.has(path.extname(absolute).toLowerCase());
};

export const isRepoSourcePath = (word, context) => isRepoFileWithExtension(word, context, SOURCE_EXTENSIONS);

// Source, docs and config files that `chemx patch` / `chemx write` should change.
export const isRepoWritePath = (word, context) => isRepoFileWithExtension(word, context, WRITE_EXTENSIONS);

// A word that stays a variable or substitution while the command runs inside the project (and outside
// free locations): its target cannot be verified. A literal absolute prefix outside the project clears it.
export const isUnresolvedInRepo = (word, context) => {
  const isVariable = UNRESOLVED_VARIABLE.test(word) || word.includes('`');
  const isCheckable = isVariable && !context.cwdUnknown;
  const prefix = isCheckable ? expandKnownVariables(word, context).split(/[$`]/)[0] : '';
  const isOutsideByPrefix = path.isAbsolute(prefix) && !isInsideDirectory(prefix, context.root);
  const cwdIsRouted = isInsideDirectory(context.cwd, context.root) && !isFreeLocation(path.resolve(context.cwd), context);
  return isCheckable && cwdIsRouted && !isOutsideByPrefix;
};

// Any path (file or directory) inside the project that is not a free location.
export const isRepoPath = (word, context) => repoPathOf(word, context) !== null;
