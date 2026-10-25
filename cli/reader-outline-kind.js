// Which files `chemx read` can outline. Anything else (yaml, json, txt, sh, sql, html) has no symbols, so a
// read past the window shows its first lines as text instead of an empty outline.
import { getLanguageForFile } from './languages.js';
import { isPhpPath } from './php/php-parse.js';
import { isMarkdownFile } from './reader-markdown.js';
import { isStylesheetFile } from './outline/style-outline.js';

export const hasOutlineExtractor = (filePath) => {
  const isCode = Boolean(getLanguageForFile(filePath));
  return isCode || isMarkdownFile(filePath) || isStylesheetFile(filePath) || isPhpPath(filePath);
};

// generateAstOutline opens every outline with `// Outline: <file>`; nothing after that line means no
// symbols or headings (a Markdown file without headings), which is no outline worth showing.
export const isEmptyOutline = (outlineText) => outlineText.split('\n').filter((line) => line.trim() !== '').length <= 1;
