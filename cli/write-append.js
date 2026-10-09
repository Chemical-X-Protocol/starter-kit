// `chemx write --append`: add content to the end of a file, creating it when missing.
// The combined text goes through writeFile, so it gets the same parse check, guardrails,
// index sync, lock checks and backup as any write. Nothing is added to the content: a newline
// the file lacks at its end is not inserted, so start the appended text with one if needed.
import fs from 'node:fs';
import { writeFile } from './patcher.js';
import { resolveSafePath } from './path-scope.js';

export const APPEND_WITH_OVERWRITE = 'append and overwrite cannot be combined: append adds to the end of the file, overwrite replaces it. Nothing was changed.';

export const appendToFile = (targetPath, params = {}) => {
  const { content, overwrite = false, cwd = process.cwd() } = params;
  if (overwrite) throw new Error(APPEND_WITH_OVERWRITE);
  const isMissingContent = typeof content !== 'string';
  if (isMissingContent) throw new Error('content is required for append');

  const resolvedPath = resolveSafePath(targetPath, cwd);
  const isExisting = fs.existsSync(resolvedPath);
  const existing = isExisting ? fs.readFileSync(resolvedPath, 'utf-8') : '';
  const result = writeFile(targetPath, { ...params, content: existing + content, overwrite: isExisting });
  return { ...result, appended: true, appendedChars: content.length };
};

// One entry point for the CLI and MCP write handlers.
export const writeOrAppend = (targetPath, params = {}) => {
  const { append = false, ...rest } = params;
  return append ? appendToFile(targetPath, rest) : writeFile(targetPath, rest);
};
