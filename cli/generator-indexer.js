import fs from 'node:fs';
import path from 'node:path';
import { isSqliteAvailable, openIndexDb } from './search-schema.js';
import { upsertFileIndex } from './search-db.js';
import { resolveArchitectureTier, extractAstMetadata } from './search-ast.js';

export const parseFileAst = (absPath, relPath) => {
  const content = fs.readFileSync(absPath, 'utf-8');
  const stat = fs.statSync(absPath);
  const lines = content.split('\n').length;
  const chars = content.length;
  const tier = resolveArchitectureTier(relPath);
  const { symbols, props, hooks, imports } = extractAstMetadata(content, absPath);
  return {
    path: relPath,
    mtime: Math.floor(stat.mtimeMs),
    size: stat.size,
    tier,
    lines,
    chars,
    symbols,
    props,
    hooks,
    imports
  };
};

export const indexGeneratedFiles = (cwd, targetDir, filesCreated = []) => {
  if (!isSqliteAvailable()) return;
  const db = openIndexDb(cwd);
  if (!db) return;

  for (const relFile of filesCreated) {
    const absPath = path.join(targetDir, relFile);
    const relPath = path.relative(cwd, absPath);
    if (fs.existsSync(absPath)) {
      const astData = parseFileAst(absPath, relPath);
      upsertFileIndex(db, astData);
    }
  }
};
