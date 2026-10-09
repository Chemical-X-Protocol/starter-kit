import { writeOrAppend } from '../write-append.js';
import { compactViolationLists, formatPatchWarnings, isDryRunRequested } from './tools-patch.js';
import { resolveSafePath } from '../path-scope.js';

export const handleChemxWrite = (args = {}, cwd = process.cwd()) => {
  const hasPath = Boolean(args.path);
  const hasContent = typeof args.content === 'string';
  const hasRequiredArgs = hasPath && hasContent;

  if (!hasRequiredArgs) {
    throw new Error('chemx_write requires "path" and string "content" arguments.');
  }

  const targetPath = resolveSafePath(args.path, cwd);
  const result = writeOrAppend(targetPath, {
    content: args.content,
    overwrite: Boolean(args.overwrite),
    append: Boolean(args.append),
    dryRun: isDryRunRequested(args),
    allowRemoved: args.allowRemoved ?? args.allowRemove,
    agentId: args.agentId ?? args.as,
    cwd
  });

  return {
    ...compactViolationLists(result, args),
    warnings: formatPatchWarnings(result)
  };
};
