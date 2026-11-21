/**
 * Chemical X Protocol: `chemx commit --hunks=<file>:<n,m-k>` commits only some hunks of a file (#7599).
 * A file other sessions are also editing cannot be committed whole without taking their half-finished
 * work. The hunks are numbered as `git diff -U0 HEAD -- <file>` lists them (1-based). The commit is built on a private index
 * that starts from HEAD, so only the listed files can differ in it and nothing another handle staged rides
 * along. Not guaranteed: hunks are cut at zero context, so two changes on adjoining lines are one hunk;
 * a spec that selects half of a change a later hunk depends on commits that half as written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGit } from './commit-git.js';

const SPEC_PART = /^(\d+)(?:-(\d+))?$/;

/** `1,3-4` to [1, 3, 4]; null when any part is not a positive number or a range that runs up. */
export const parseRanges = (spec) => {
  const numbers = [];
  for (const part of spec.split(',')) {
    const found = SPEC_PART.exec(part.trim());
    if (!found) return null;
    const from = Number(found[1]);
    const to = found[2] === undefined ? from : Number(found[2]);
    const isBackwards = from < 1 || to < from;
    if (isBackwards) return null;
    for (let at = from; at <= to; at += 1) numbers.push(at);
  }
  return numbers;
};

/** `--hunks` values to { file, numbers } entries and the messages for any that cannot be read. */
export const parseHunkSpecs = (raw) => {
  const specs = [];
  const errors = [];
  for (const value of raw) {
    const colon = value.lastIndexOf(':');
    const file = colon > 0 ? value.slice(0, colon) : '';
    const numbers = colon > 0 ? parseRanges(value.slice(colon + 1)) : null;
    const isBad = file === '' || numbers === null;
    if (isBad) errors.push(`Refused: --hunks=${value} is not <file>:<n[,n|a-b]> with hunk numbers from 1.`);
    else specs.push({ file, numbers });
  }
  return { specs, errors };
};

/** A diff cut into its header lines and its hunks, each hunk with its own header and body. */
export const splitDiff = (diff) => {
  const lines = diff.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  const hasNoHunks = firstHunk < 0;
  if (hasNoHunks) return { header: lines, hunks: [] };
  const hunks = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@')) hunks.push([line]);
    else hunks[hunks.length - 1].push(line);
  }
  return { header: lines.slice(0, firstHunk), hunks };
};

/** The patch holding only the wanted hunks of one file, or the reasons it cannot be cut. */
export const patchFor = (root, spec) => {
  const diff = runGit(root, ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', spec.file]);
  const { header, hunks } = splitDiff(diff.stdout);
  const outOfRange = spec.numbers.filter((number) => number > hunks.length);
  const isEmpty = hunks.length === 0;
  if (isEmpty) return { errors: [`Refused: ${spec.file} has no changes against HEAD to take hunks from.`] };
  if (outOfRange.length) return { errors: [`Refused: ${spec.file} has ${hunks.length} hunk(s) against HEAD; there is no hunk ${outOfRange.join(', ')}.`] };
  const chosen = [...new Set(spec.numbers)].sort((a, b) => a - b).flatMap((number) => hunks[number - 1]);
  return { patch: [...header, ...chosen].join('\n').replace(/\n*$/, '\n'), errors: [] };
};

const privateIndex = (root) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-commit-index-'));
  const hasHead = runGit(root, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
  return { dir, file: path.join(dir, 'index'), hasHead };
};

/**
 * Builds the index the commit is made from: HEAD, then the whole listed files, then the chosen hunks of
 * the others. Returns the env to commit with and a cleanup, or the reasons it could not be built.
 */
export const buildHunkIndex = (root, files, specs, env) => {
  const { dir, file, hasHead } = privateIndex(root);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const indexEnv = { ...env, GIT_INDEX_FILE: file };
  const fail = (errors) => { cleanup(); return { errors }; };
  const reading = runGit(root, hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], indexEnv);
  const isReadFailed = reading.status !== 0;
  if (isReadFailed) return fail([`Failed: could not start a private index. ${reading.output.trim()}`]);
  const partial = new Set(specs.map((spec) => spec.file));
  const whole = files.filter((candidate) => !partial.has(candidate));
  const adding = whole.length ? runGit(root, ['add', '--', ...whole], indexEnv) : { status: 0, output: '' };
  const isAddFailed = adding.status !== 0;
  if (isAddFailed) return fail([`Failed: git add did not complete. ${adding.output.trim()}`]);
  for (const spec of specs) {
    const cut = patchFor(root, spec);
    const isCutFailed = cut.errors.length > 0;
    if (isCutFailed) return fail(cut.errors);
    const applied = spawnSync('git', ['apply', '--cached', '--unidiff-zero', '-'], { cwd: root, encoding: 'utf-8', env: indexEnv, input: cut.patch });
    const isApplyFailed = applied.status !== 0;
    if (isApplyFailed) return fail([`Failed: the chosen hunks of ${spec.file} did not apply. ${(applied.stderr ?? '').trim()}`]);
  }
  return { env: indexEnv, cleanup, errors: [] };
};

/** After the commit, the real index entries of the listed files are put level with the new HEAD. */
export const levelIndex = (root, files) => runGit(root, ['reset', '-q', '--', ...files]).status === 0;
