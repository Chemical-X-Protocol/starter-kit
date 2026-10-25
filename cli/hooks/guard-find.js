// What `chemx f` covers of a `find` call (#6756, K11). chemx f lists tracked and untracked-but-not-ignored
// files whose path contains a text or matches a glob. A find that only asks for that is 'covered' (deny);
// one that adds structure chemx f approximates (depth limits, directories, alternation) is 'near' (nudge);
// one that filters on something chemx f cannot see (time, size, mode...) is 'uncovered' (allowed);
// one that acts on the files (-delete, -exec...) or looks outside the repo is null (not routed).

import { optionValue } from './guard-args.js';
import { isRepoPath } from './guard-paths.js';

const FIND_MUTATING_TESTS = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/;
const COVERED_TESTS = new Set(['-name', '-iname', '-path', '-ipath', '-print']);
const NEAR_TESTS = new Set(['-maxdepth', '-mindepth', '-not', '!', '-o', '-or', '-a', '-and', '-prune', '(', ')', '-regextype']);
const FILE_ONLY_TYPES = new Set(['f']);
// Tests whose value is a separate word, so the value is not mistaken for a root or a test.
const VALUE_TESTS = new Set(['-name', '-iname', '-path', '-ipath', '-maxdepth', '-mindepth', '-type']);

export const findRoots = (args) => {
  const end = args.findIndex((arg) => arg.startsWith('-') || arg === '(' || arg === '!');
  const roots = end === -1 ? args : args.slice(0, end);
  return roots.length > 0 ? roots : ['.'];
};

const testsOf = (args) => args.filter((arg) => (arg.startsWith('-') && arg.length > 1) || arg === '!' || arg === '(' || arg === ')');

/** 'covered' | 'near' | 'uncovered' for a find in the project, else null. */
export const findShape = ({ tool, args }, context) => {
  const isFind = tool === 'find';
  const isMutating = args.some((arg) => FIND_MUTATING_TESTS.test(arg));
  const looksInRepo = isFind && !isMutating && findRoots(args).some((root) => isRepoPath(root, context));
  if (!looksInRepo) return null;
  const tests = testsOf(args);
  const hasUnknownTest = tests.some((test) => !COVERED_TESTS.has(test) && !NEAR_TESTS.has(test) && !VALUE_TESTS.has(test));
  if (hasUnknownTest) return 'uncovered';
  const type = optionValue(args, ['-type']);
  const isNonFileType = type !== null && !FILE_ONLY_TYPES.has(type);
  const isNear = isNonFileType || tests.some((test) => NEAR_TESTS.has(test));
  return isNear ? 'near' : 'covered';
};
