// Files Forge never fingerprints (engine doc section 1, Exclusions):
//   blueprints/**, library/** (root-relative), cli/**/fixtures/**, *.d.ts (components*.d.ts included),
//   dist and node_modules at any depth, and any file carrying a GENERATED_MARKERS signature.
// Specs are not excluded here: they are fingerprinted under their own facet (spec=true).
import { isGeneratedContent } from '../pillars-write-guard.js';

const ROOT_EXCLUDED_DIRS = new Set(['blueprints', 'library']);
const ANY_DEPTH_EXCLUDED_DIRS = new Set(['dist', 'node_modules']);

/** True when relativePath (forward or back slashes) or its content puts the file outside Forge. */
export const isForgeExcluded = (relativePath, content = '') => {
  const segments = relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
  const directories = segments.slice(0, -1);
  const fileName = segments.at(-1) ?? '';
  const isRootExcluded = ROOT_EXCLUDED_DIRS.has(directories[0]);
  const isDeepExcluded = directories.some((segment) => ANY_DEPTH_EXCLUDED_DIRS.has(segment));
  const isCliFixture = directories[0] === 'cli' && directories.includes('fixtures');
  const isDeclarationFile = fileName.endsWith('.d.ts');
  const isPathExcluded = isRootExcluded || isDeepExcluded || isCliFixture || isDeclarationFile;
  return isPathExcluded || isGeneratedContent(content);
};
