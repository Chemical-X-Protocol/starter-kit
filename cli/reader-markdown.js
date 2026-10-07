/**
 * Markdown outline: the heading tree with line numbers and an approximate token count per
 * section, so a reader can choose a startLine/endLine slice. Babel-based outlines read prose
 * as code and invent symbols, so Markdown never reaches them. Fenced code is skipped.
 */

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const CODE_FENCE = /^\s*(```|~~~)/;
const MARKDOWN_HEADING = /^#{1,6}\s+\S/;

export const isMarkdownFile = (filePath) => MARKDOWN_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));

export const generateMarkdownOutline = (text, filePath) => {
  const sections = [];
  let isInFence = false;
  text.split('\n').forEach((line, index) => {
    const isFenceLine = CODE_FENCE.test(line);
    const isHeading = !isInFence && !isFenceLine && MARKDOWN_HEADING.test(line);
    if (isFenceLine) isInFence = !isInFence;
    if (isHeading) sections.push({ line: index + 1, heading: line.trim(), chars: 0 });
    const hasOpenSection = sections.length > 0;
    if (hasOpenSection) sections[sections.length - 1].chars += line.length + 1;
  });
  const rows = sections.map((s) => `L${s.line}  ${s.heading}  (~${Math.round(s.chars / 3.8)} tokens)`);
  return [`// Outline: ${filePath}`, ...rows].join('\n');
};
