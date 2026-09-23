import path from 'node:path';
import { syncSingleFileIndex } from '../search.js';
import { writeFile } from '../patcher.js';
import { formatPatchWarnings } from './tools-patch.js';

export const handleChemxWrite = (args = {}, cwd = process.cwd()) => {
  const hasPath = Boolean(args.path);
  const hasContent = args.content !== undefined;
  const hasRequiredArgs = hasPath && hasContent;

  if (!hasRequiredArgs) {
    throw new Error('chemx_write requires "path" and "content" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = writeFile(targetPath, {
    content: args.content,
    cwd
  });

  try {
    syncSingleFileIndex(targetPath, cwd);
  } catch (err) {
    if (process.env.CHEMX_DEBUG) {
      process.stderr.write(`[write-sync] Auto-index skipped for ${targetPath}: ${err.message}\n`);
    }
  }

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};
