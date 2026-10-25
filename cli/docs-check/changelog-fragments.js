/**
 * Changelog fragments: one Markdown file per change in docs/changelog.d/, so two tickets
 * never edit the same lines of docs/CHANGELOG.md. This module reads and validates them;
 * changelog-fold.js merges them and changelog-run.js is the `chemx changelog` command.
 */
import fs from 'node:fs';
import path from 'node:path';

export const FRAGMENT_DIR = 'docs/changelog.d';
export const CHANGELOG_FILE = 'docs/CHANGELOG.md';

const SECTION_HEADING = /^### \S/;
const ANY_HEADING = /^#{1,3} /;
const FENCE = /^\s*(```|~~~)/;
const FRAGMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
// The folder's own notes and git placeholders are not fragments.
const NOT_FRAGMENTS = new Set(['readme.md', '.gitkeep']);

/** Lines of `lines` that sit outside a fenced code block, with their 0-based index. */
export const outsideFences = (lines) => {
  let isFenced = false;
  return lines.flatMap((line, index) => {
    const isFence = FENCE.test(line);
    if (isFence) isFenced = !isFenced;
    return isFence || isFenced ? [] : [{ line, index }];
  });
};

const trimBlankEdges = (lines) => {
  const isFilled = (line) => line.trim() !== '';
  const first = lines.findIndex(isFilled);
  const last = lines.findLastIndex(isFilled);
  return lines.slice(first === -1 ? 0 : first, last + 1);
};

const findHeadingProblem = (bodyLines) => {
  const stray = outsideFences(bodyLines).find(({ line }) => ANY_HEADING.test(line));
  // bodyLines start at file line 2 (line 1 is the section heading).
  return stray ? `line ${stray.index + 2}: another heading; one section per fragment (use #### or bold for a subhead, one file per change)` : null;
};

/** @returns {{file:string, heading:string|null, body:string[], problems:string[]}} */
export const parseFragment = (file, text) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const heading = lines[0].trimEnd();
  const problems = [];
  const isNameOk = FRAGMENT_NAME.test(file);
  if (!isNameOk) problems.push('name the file <ticket-or-slug>.md (letters, digits, . _ - only)');
  const isHeadingOk = SECTION_HEADING.test(heading);
  if (!isHeadingOk) {
    problems.push('first line must be a `### <section>` heading (for example `### Fixed` or `### Added`), then the text');
    return { file, heading: null, body: [], problems };
  }
  const bodyLines = lines.slice(1);
  const body = trimBlankEdges(bodyLines);
  const isBodyEmpty = body.length === 0;
  const headingProblem = findHeadingProblem(bodyLines);
  const bodyProblems = [isBodyEmpty ? 'nothing under the heading: add the bullets or paragraphs for this change' : null, headingProblem];
  problems.push(...bodyProblems.filter(Boolean));
  return { file, heading, body, problems };
};

const strayProblem = (file) => ({ file, heading: null, body: [], problems: ['not a .md fragment: rename it <ticket-or-slug>.md or delete it'] });
const folderProblem = (file) => ({ file, heading: null, body: [], problems: ['a folder: fragments sit directly in the fragments folder'] });

const isFragmentEntry = (entry) => !NOT_FRAGMENTS.has(entry.name.toLowerCase());

/** Every fragment in `<root>/docs/changelog.d`, in file name order. A missing folder is no fragments. */
export const readFragments = (root) => {
  const dir = path.join(root, FRAGMENT_DIR);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(isFragmentEntry);
  const sorted = entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  return sorted.map((entry) => {
    if (entry.isDirectory()) return folderProblem(entry.name);
    const isMarkdown = entry.name.toLowerCase().endsWith('.md');
    return isMarkdown ? parseFragment(entry.name, fs.readFileSync(path.join(dir, entry.name), 'utf8')) : strayProblem(entry.name);
  });
};
