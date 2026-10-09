/**
 * Chemical X Protocol: which recorded invocations bypassed chemx (#2561).
 * A bypass is a shell write into a path inside a repo (sed -i, perl -i, awk -i inplace, tee, or a > / >> /
 * &> redirect, heredocs included) or a native Read/Edit/Write/Glob/Grep/NotebookEdit on a repo path.
 *
 * Not a finding: a shell command that touches /tmp, mktemp or ~/.claude (scratch work), a target outside
 * every repo root (so a native call on a /tmp file), /dev/*, and a native call on ~/.claude or node_modules.
 * Limits: a target built from a glob cannot be resolved and is skipped, never guessed; an in-place sed, perl or
 * awk edit whose target is a variable or substitution, run in a directory inside a repo, is reported as an
 * unresolved-target bypass at that directory (so is one with no file operand under xargs or find -exec; other writers with such a target are skipped); a write made by an interpreter (node -e, python -c) is not seen; repo roots are the nearest .git
 * above each call's recorded cwd (the cwd itself when none exists on this machine).
 */
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../hooks/repo-membership.js';
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>']);
const SCRIPT_FLAGS = new Set(['-e', '-f', '-E']);
const UNRESOLVED = /[$`*?{]/;
const VARIABLE_WORD = /[$`]/;
// /tmp is not listed: a path there is a finding only when a recorded repo root sits above it.
const SCRATCH_ROOTS = ['/dev', '/proc'];

const isUnder = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const isFlag = (word) => word.startsWith('-');

/** Repo roots for a set of recorded cwds (plus explicit ones). */
export const repoRootsOf = (cwds, extra = []) => {
  const roots = new Set(extra.map((r) => path.resolve(r)));
  for (const cwd of cwds) {
    const hasCwd = Boolean(cwd);
    if (!hasCwd) continue;
    roots.add(findRepoRoot(path.join(cwd, '_')) ?? cwd);
  }
  return [...roots];
};

const homeOf = (word, home) => (word === '~' || word.startsWith('~/') ? path.join(home, word.slice(1)) : word);

/** Absolute path of a written word as the call saw it, or null when it cannot be resolved. */
export const resolveWord = (inv, word, home = os.homedir()) => {
  const text = String(word ?? '');
  const isOpaque = text === '' || UNRESOLVED.test(text);
  if (isOpaque) return null;
  const expanded = homeOf(text, home);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  const steps = inv.dir?.steps ?? [];
  const isMoved = inv.dir?.unknown || steps.some((s) => UNRESOLVED.test(s));
  const isUnresolvable = isMoved || !inv.cwd;
  if (isUnresolvable) return null;
  const base = steps.reduce((dir, step) => path.resolve(dir, homeOf(step, home)), inv.cwd);
  return path.resolve(base, expanded);
};

// Files named after the program/script words of sed, perl and awk.
const scriptFiles = (args) => {
  const files = [];
  let hasScript = false;
  let skipNext = false;
  for (const word of args) {
    const isSkipped = skipNext;
    skipNext = false;
    if (isSkipped) continue;
    const isScriptFlag = SCRIPT_FLAGS.has(word);
    if (isScriptFlag) { hasScript = true; skipNext = true; continue; }
    if (isFlag(word)) continue;
    const isProgram = !hasScript;
    if (isProgram) { hasScript = true; continue; }
    files.push(word);
  }
  return files;
};

const isShortInPlace = (word) => /^-[a-zA-Z]*i/.test(word) && !word.startsWith('--');

const EDITOR_HEADS = new Set(['sed', 'perl', 'awk', 'gawk']);
const XARGS_VALUE_FLAGS = new Set(['-I', '-i', '-n', '-L', '-P', '-s', '-d', '-E', '-a']);

// The sed/perl/awk command that an xargs or find -exec runs, as its own argv.
const xargsArgv = (args) => {
  const at = args.findIndex((w, i) => !isFlag(w) && !XARGS_VALUE_FLAGS.has(args[i - 1]));
  return at === -1 ? [] : args.slice(at);
};
const findExecArgv = (args) => {
  const from = args.findIndex((w) => /^-(?:exec|execdir|ok|okdir)$/.test(w));
  const tail = from === -1 ? [] : args.slice(from + 1);
  const end = tail.findIndex((w) => w === ';' || w === '+');
  return end === -1 ? tail : tail.slice(0, end);
};
const EMBEDDERS = { xargs: xargsArgv, find: findExecArgv };

// Files come from a pipe or find: nothing to resolve, so report the edit as an unresolved target.
const embeddedWrites = (argv) => {
  const inner = (EMBEDDERS[argv[0]]?.(argv.slice(1)) ?? []);
  const found = EDITOR_HEADS.has(inner[0]) ? editorWritesOf(inner) : null;
  const isInPlace = found !== null && found.how !== 'tee';
  const isBlind = isInPlace && (found.files.length === 0 || found.files.includes('{}'));
  return isBlind ? { how: found.how, files: ['$(piped)'] } : null;
};

const editorWrites = (argv) => editorWritesOf(argv) ?? embeddedWrites(argv);

function editorWritesOf(argv) {
  const [head, ...args] = argv;
  const isInPlaceFlag = args.some((w) => isShortInPlace(w) || w === '--in-place' || w.startsWith('--in-place='));
  const isSed = head === 'sed' && isInPlaceFlag;
  const isPerl = head === 'perl' && args.some(isShortInPlace);
  const awkAt = args.indexOf('-i');
  const isAwk = ['awk', 'gawk'].includes(head) && awkAt !== -1 && args[awkAt + 1] === 'inplace';
  if (isSed) return { how: 'sed -i', files: scriptFiles(args) };
  if (isPerl) return { how: 'perl -i', files: scriptFiles(args) };
  if (isAwk) return { how: 'awk -i inplace', files: scriptFiles(args.filter((w, i) => i !== awkAt && i !== awkAt + 1)) };
  const isTee = head === 'tee';
  return isTee ? { how: 'tee', files: args.filter((w) => !isFlag(w)) } : null;
}

const redirectTargets = (inv) => inv.redirects.filter((r) => WRITE_OPS.has(r.op)).map((r) => ({ how: `redirect ${r.op}`, word: r.target }));

const isScratchPath = (abs, home) => SCRATCH_ROOTS.some((root) => isUnder(abs, root)) || isUnder(abs, path.join(home, '.claude'));

const isRepoPath = (abs, roots, home) => {
  const isScratch = isScratchPath(abs, home);
  const isVendored = abs.split(path.sep).includes('node_modules');
  const isInRepo = roots.some((root) => isUnder(abs, root));
  return isInRepo && !isScratch && !isVendored;
};

/**
 * Shell writes of one invocation into repo paths.
 * @returns {Array<{ how: string, target: string }>} target is the absolute path
 */
export const shellWritesOf = (inv, roots, home = os.homedir()) => {
  // Scratch is judged on this command's own words, not on the whole line it shares with other commands.
  const isScratch = inv.isSegmentScratch ?? inv.isScratch;
  const isCounted = inv.kind === 'shell' && !isScratch;
  if (!isCounted) return [];
  const editor = editorWrites(inv.argv);
  const words = [...redirectTargets(inv), ...(editor ? editor.files.map((word) => ({ how: editor.how, word, isInPlace: editor.how !== 'tee' })) : [])];
  const cwdHere = resolveWord(inv, '.', home);
  const writes = [];
  for (const { how, word, isInPlace } of words) {
    const abs = resolveWord(inv, word, home);
    const isHit = abs !== null && isRepoPath(abs, roots, home);
    if (isHit) writes.push({ how, target: abs });
    // An in-place edit whose target stays a variable, run inside a repo, is reported at the directory it ran in.
    const isUnresolvedHere = isInPlace && abs === null && VARIABLE_WORD.test(String(word)) && cwdHere !== null && isRepoPath(cwdHere, roots, home);
    if (isUnresolvedHere) writes.push({ how: `${how} (unresolved target)`, target: cwdHere });
  }
  return writes;
};

/** A native file tool on a repo path (a Glob/Grep with no path acts on the recorded cwd). */
export const nativeBypassOf = (inv, roots, home = os.homedir()) => {
  const isNative = inv.kind === 'native';
  if (!isNative) return null;
  const word = inv.path ?? inv.cwd;
  const abs = resolveWord({ ...inv, dir: { steps: [], unknown: false } }, word, home);
  const isHit = abs !== null && isRepoPath(abs, roots, home);
  return isHit ? { how: inv.tool, target: abs } : null;
};
