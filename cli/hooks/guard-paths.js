// Decide whether a shell word names a source file inside the project. Only those reads are
// routed through `chemx read`; data, logs, temp files and anything outside the repo stay free.

import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx', '.vue', '.svelte', '.scss', '.php']);
const VENDORED_SEGMENTS = ['/node_modules/', '/.git/', '/dist/', '/.chemx/'];
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

export const isRepoSourcePath = (word, context) => {
  const hasUnknownVariable = UNRESOLVED_VARIABLE.test(word);
  if (hasUnknownVariable) return false;
  const expanded = expandKnownVariables(word, context);
  const hasSourceExtension = SOURCE_EXTENSIONS.has(path.extname(expanded).toLowerCase());
  if (!hasSourceExtension) return false;
  const absolute = path.resolve(context.cwd, expanded);
  const isInRepo = isInsideDirectory(absolute, context.root);
  const isVendored = VENDORED_SEGMENTS.some((segment) => `${absolute}/`.includes(segment));
  return isInRepo && !isVendored;
};
