/**
 * Chemical X Protocol: Task tier resolution.
 * A tier describes component work, so only an explicit --tier or a code --target implies one.
 * Planning, epic and docs tasks stay untiered instead of defaulting to 'molecule'.
 */

import { isSourceFile } from '../languages.js';
import { resolveArchitectureTier } from '../search-ast.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

export const resolveTaskTier = (explicitTier, targetPath) => {
  if (isNonEmptyString(explicitTier)) return explicitTier.trim();
  const isCodeTarget = isNonEmptyString(targetPath) && isSourceFile(targetPath);
  if (!isCodeTarget) return '';
  return resolveArchitectureTier(targetPath.replace(/\\/g, '/'));
};
