/**
 * Folds changelog fragments (changelog-fragments.js) into the `## Unreleased` section of
 * docs/CHANGELOG.md. Pure text in, text out: nothing here touches the disk.
 * New sections go above the existing ones (the file is newest first); a heading that
 * Unreleased already has gets the new text at the end of that section. Every other line
 * of the file stays as it was.
 */
import { outsideFences } from './changelog-fragments.js';

const UNRELEASED = /^## Unreleased\b/;
const SECOND_LEVEL = /^## /;
const THIRD_LEVEL = /^### /;
const LIST_ITEM = /^\s*([-*+]|\d+\.) /;

const isBlank = (line) => line.trim() === '';

const indexesMatching = (lines, pattern) => outsideFences(lines).filter(({ line }) => pattern.test(line)).map(({ index }) => index);

/** The Unreleased block as [start, end): the heading line to the next `## ` (or the end of the file). */
const findUnreleased = (lines) => {
  const [start] = indexesMatching(lines, UNRELEASED);
  const end = indexesMatching(lines, SECOND_LEVEL).find((index) => index > start) ?? lines.length;
  return start === undefined ? null : { start, end };
};

/** The `### ` sections inside the block: { heading, at, end }. */
const findSections = (lines, block) => {
  const starts = indexesMatching(lines, THIRD_LEVEL).filter((index) => index > block.start && index < block.end);
  return starts.map((at, position) => ({ heading: lines[at].trimEnd(), at, end: starts[position + 1] ?? block.end }));
};

/** The index just past the last filled line in [from, to), or `from` when they are all blank. */
const contentEnd = (lines, from, to) => {
  const filled = lines.slice(from, to).findLastIndex((line) => !isBlank(line));
  return from + filled + 1;
};

const continuesList = (previousLines, body) => LIST_ITEM.test(previousLines.at(-1) ?? '') && LIST_ITEM.test(body[0]);

/** Body texts of one heading as one body: bullets continue a list, anything else follows a blank line. */
const joinBodies = (bodies) => bodies.reduce((joined, body) => [...joined, ...(continuesList(joined, body) ? [] : ['']), ...body]);

const groupByHeading = (fragments) => {
  const groups = new Map();
  for (const fragment of fragments) {
    const group = groups.get(fragment.heading) ?? { heading: fragment.heading, bodies: [], files: [] };
    group.bodies.push(fragment.body);
    group.files.push(fragment.file);
    groups.set(fragment.heading, group);
  }
  return [...groups.values()].map((group) => ({ heading: group.heading, body: joinBodies(group.bodies), files: group.files }));
};

const insertAt = (lines, index, added) => [...lines.slice(0, index), ...added, ...lines.slice(index)];

const appendToSection = (lines, group) => {
  const block = findUnreleased(lines);
  const section = findSections(lines, block).find((candidate) => candidate.heading === group.heading);
  const at = contentEnd(lines, section.at + 1, section.end);
  const previous = lines.slice(section.at, at);
  return insertAt(lines, at, [...(continuesList(previous, group.body) ? [] : ['']), ...group.body]);
};

const addNewSections = (lines, groups) => {
  const block = findUnreleased(lines);
  const [first] = findSections(lines, block);
  const rendered = groups.flatMap((group) => [group.heading, '', ...group.body, '']);
  if (first) return insertAt(lines, first.at, rendered);
  const at = contentEnd(lines, block.start + 1, block.end);
  return insertAt(lines, at, ['', ...rendered.slice(0, -1)]);
};

const sectionsOf = (lines) => findSections(lines, findUnreleased(lines)).map((section) => section.heading);

/**
 * @param {string} changelogText
 * @param {Array<{file:string, heading:string, body:string[], problems:string[]}>} fragments in file name order
 * @returns {{text:string, sections:Array<{heading:string, how:'new'|'appended', files:string[]}>} | {reason:string}}
 */
export const foldFragments = (changelogText, fragments) => {
  const broken = fragments.find((fragment) => fragment.problems.length > 0);
  const hasNothingToFold = fragments.length === 0;
  const original = changelogText.split('\n');
  const hasUnreleased = findUnreleased(original) !== null;
  const refusal = broken ? `${broken.file}: ${broken.problems[0]}` : 'no `## Unreleased` section to fold into';
  if (hasNothingToFold) return { text: changelogText, sections: [] };
  const isFoldable = !broken && hasUnreleased;
  if (!isFoldable) return { reason: refusal };
  const groups = groupByHeading(fragments);
  const existing = new Set(sectionsOf(original));
  const merged = groups.filter((group) => existing.has(group.heading));
  const fresh = groups.filter((group) => !existing.has(group.heading));
  const appended = merged.reduce(appendToSection, original);
  const lines = fresh.length > 0 ? addNewSections(appended, fresh) : appended;
  const text = lines.join('\n');
  const sections = groups.map((group) => ({ heading: group.heading, how: existing.has(group.heading) ? 'appended' : 'new', files: group.files }));
  return { text: text.endsWith('\n') ? text : `${text}\n`, sections };
};
