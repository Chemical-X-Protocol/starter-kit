/**
 * How many local import edges (relative, aliased, template component tags) the
 * index could resolve to a file. Blast radius reports it so a low consumer count
 * on a poorly resolved index is never shown as a confident answer.
 */
import { resolveAliasBase } from './module-aliases.js';
import { isComponentSpecifier } from './component-resolver.js';

const isLocalSpecifier = (sourceModule, cwd) => {
  const isRelative = sourceModule.startsWith('.') || sourceModule.startsWith('/');
  if (isRelative) return true;
  if (isComponentSpecifier(sourceModule)) return true;
  return resolveAliasBase(sourceModule, cwd) !== null;
};

export const computeImportCoverage = (db, cwd = process.cwd()) => {
  const rows = db.prepare('SELECT source_module AS sourceModule, resolved_path AS resolvedPath FROM imports').all();
  const local = rows.filter((row) => isLocalSpecifier(String(row.sourceModule || ''), cwd));
  const unresolved = local.filter((row) => !row.resolvedPath);
  const resolvedPct = local.length > 0 ? Math.round(((local.length - unresolved.length) / local.length) * 100) : 100;
  const samples = [...new Set(unresolved.map((row) => row.sourceModule))].slice(0, 5);
  return { localImports: local.length, unresolvedImports: unresolved.length, resolvedPct, unresolvedSamples: samples };
};
