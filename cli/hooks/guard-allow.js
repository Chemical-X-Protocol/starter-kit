// Segments the guard leaves alone, with no deny, no nudge and no bypass comment (#6756, K11):
//  - the repo's own allow-list, `.chemxrc` { "guard": { "allow": ["node tests/run-tests.mjs"] } }, each
//    entry a command prefix matched word by word (`test.runners` entries are the same list, K9's name);
//  - tool existence and version probes (`command -v vitest`, `tsc --version`), which run nothing;
//  - `guard.plainGit: true`, which drops the git status/add/commit nudges for repos whose protocol
//    mandates plain git.
// A config is read from the command's directory up to the project root; an unreadable one lists nothing.

import path from 'node:path';
import { findAndLoadConfigFile } from '../config/loader.js';
import { isInsideDirectory } from './guard-paths.js';
import { stripWrappers } from './guard-invocation.js';

const PROBE_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h']);
const COMMAND_PROBE_FLAG = /^-[vVp]+$/;
const NO_SETTINGS = Object.freeze({ allow: Object.freeze([]), plainGit: false });

const stringsIn = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);

/** The allow-list and plainGit of the config file in exactly this directory. */
export const guardSettingsAt = (dir) => {
  try {
    const raw = findAndLoadConfigFile(dir)?.raw ?? {};
    return { allow: [...stringsIn(raw.guard?.allow), ...stringsIn(raw.test?.runners)], plainGit: raw.guard?.plainGit === true };
  } catch { // chemx-allow: best-effort an unreadable config lists nothing, so the guard stays as strict as before
    return NO_SETTINGS;
  }
};

/** The directory and every directory above it up to the project root. */
export const directoriesUpTo = (start, root) => {
  const dirs = [];
  let dir = start;
  while (isInsideDirectory(dir, root)) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    const isFilesystemRoot = parent === dir;
    if (isFilesystemRoot) break;
    dir = parent;
  }
  return dirs;
};

// One command line reads each directory's config once: the caller shares a Map as context.settingsCache.
const settingsAtCached = (dir, cache) => {
  if (!cache) return guardSettingsAt(dir);
  if (!cache.has(dir)) cache.set(dir, guardSettingsAt(dir));
  return cache.get(dir);
};

/**
 * Settings that apply where a command runs. A context can carry `guardAllow` and `plainGit` itself
 * (specs, callers that already read the config); otherwise the config files are read.
 */
export const guardSettings = (context) => {
  const hasGiven = Array.isArray(context.guardAllow) || context.plainGit !== undefined;
  if (hasGiven) return { allow: stringsIn(context.guardAllow), plainGit: context.plainGit === true };
  const start = isInsideDirectory(context.cwd, context.root) ? context.cwd : context.root;
  const found = directoriesUpTo(path.resolve(start), path.resolve(context.root)).map((dir) => settingsAtCached(dir, context.settingsCache));
  return { allow: found.flatMap((settings) => settings.allow), plainGit: found.some((settings) => settings.plainGit) };
};

const normalizeWord = (word) => String(word ?? '').replace(/^\.\//, '');

const matchesEntry = (argv, entry) => {
  const wanted = entry.trim().split(/\s+/).filter(Boolean).map(normalizeWord);
  return wanted.length > 0 && wanted.every((word, index) => normalizeWord(argv[index]) === word);
};

/** True when the segment's words (as written, or after env/timeout/nice wrappers) start with a listed entry. */
export const isAllowListed = (parsed, allow) => {
  const spellings = [parsed.argv, stripWrappers(parsed.argv)];
  return allow.some((entry) => spellings.some((argv) => matchesEntry(argv, entry)));
};

/** `command -v tool` and `tool --version|-v|--help`: asking whether a tool exists, not running it. */
export const isToolProbe = (parsed, invocation) => {
  const isCommandProbe = parsed.argv[0] === 'command' && COMMAND_PROBE_FLAG.test(parsed.argv[1] ?? '');
  const isSingleProbeFlag = invocation.args.length === 1 && PROBE_FLAGS.has(invocation.args[0]);
  return isCommandProbe || isSingleProbeFlag;
};

/** The git nudges `guard.plainGit` silences. */
export const PLAIN_GIT_NUDGES = new Set(['nudge-git-status', 'nudge-git-add', 'nudge-git-commit']);
