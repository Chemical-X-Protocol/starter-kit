/**
 * arch-index.js: Semantic Architecture & Capsule Indexing Primitive.
 * Queries .chemx/index.db (or fallback directory scan) to map codebase structure,
 * capsule hierarchies, public contracts, and intent-to-capsule routing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb } from './search-schema.js';
import { resolveFileTier } from './audit/line-budgets.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'add', 'create', 'update', 'fix'
]);

export const normalizeTierName = (rawTier = '') => {
  const lower = String(rawTier).toLowerCase();
  if (lower.startsWith('atom')) return 'Atom';
  if (lower.startsWith('molecule')) return 'Molecule';
  if (lower.startsWith('organism')) return 'Organism';
  const isHook = lower.startsWith('hook') || lower.startsWith('composable');
  if (isHook) return 'Hook';
  if (lower.startsWith('store')) return 'Store';
  const isView = lower.startsWith('view') || lower.endsWith('.vue');
  if (isView) return 'View';
  if (lower.startsWith('controller')) return 'Controller';
  const isLayout = lower.startsWith('template') || lower.startsWith('layout');
  if (isLayout) return 'Layout';
  return 'Utility';
};

export const inferFileTier = (relPath = '') => {
  const base = path.basename(relPath).toLowerCase();
  const dir = path.dirname(relPath).toLowerCase();

  const isController = base.endsWith('.controller.ts') || base.endsWith('.controller.js');
  if (isController) return 'Controller';

  const isStore = base.endsWith('.store.ts') || base.endsWith('.store.js') || dir.includes('/stores');
  if (isStore) return 'Store';

  const isHook = base.startsWith('use') || dir.includes('/composables') || dir.includes('/hooks');
  if (isHook) return 'Hook';

  const isAtom = base.startsWith('a-') || dir.includes('/atoms') || dir.includes('/foundations');
  if (isAtom) return 'Atom';

  const isMolecule = base.startsWith('m-') || dir.includes('/molecules') || dir.includes('/prefabs');
  if (isMolecule) return 'Molecule';

  const isOrganism = base.startsWith('o-') || dir.includes('/organisms') || dir.includes('/modules');
  if (isOrganism) return 'Organism';

  const isView = base.endsWith('.vue') || dir.includes('/views') || dir.includes('/routes');
  if (isView) return 'View';

  const isLayout = dir.includes('/layouts') || dir.includes('/blueprints');
  if (isLayout) return 'Layout';

  return 'Utility';
};

const countFileLines = (fullPath) => {
  try {
    const text = fs.readFileSync(fullPath, 'utf-8');
    return text.split('\n').length;
  } catch {
    return 0;
  }
};

export const discoverCapsulesFromFs = (targetDir, cwd = process.cwd()) => {
  const absTarget = path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
  const exists = fs.existsSync(absTarget);
  if (!exists) return [];

  const foundFiles = [];
  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(currentDir, ent.name);
      const isDir = ent.isDirectory();
      const isIgnored = ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist';
      if (isIgnored) continue;

      if (isDir) {
        walk(full);
      } else {
        const isSource = /\.(vue|ts|js|tsx|jsx)$/i.test(ent.name) && !ent.name.endsWith('.spec.ts') && !ent.name.endsWith('.test.ts');
        if (isSource) {
          const rel = path.relative(cwd, full);
          foundFiles.push({
            fullPath: full,
            relPath: rel,
            lines: countFileLines(full),
            tier: inferFileTier(rel)
          });
        }
      }
    }
  };

  walk(absTarget);

  const capsuleMap = new Map();
  for (const f of foundFiles) {
    const dir = path.dirname(f.relPath);
    const dirName = path.basename(dir);
    const isCapsuleDir = dirName.startsWith('m-') || dirName.startsWith('o-') || dirName.startsWith('a-');
    const capsuleKey = isCapsuleDir ? dir : f.relPath;
    const capsuleName = isCapsuleDir ? dirName : path.basename(f.relPath, path.extname(f.relPath));

    const existing = capsuleMap.get(capsuleKey) || {
      name: capsuleName,
      path: capsuleKey,
      tier: f.tier,
      lines: 0,
      files: [],
      exports: [],
      consumers: 0,
      hazardCount: 0
    };

    existing.lines += f.lines;
    existing.files.push(f.relPath);
    const isHigherTier = f.tier === 'Organism' || (f.tier === 'Molecule' && existing.tier !== 'Organism');
    if (isHigherTier) existing.tier = f.tier;

    capsuleMap.set(capsuleKey, existing);
  }

  return Array.from(capsuleMap.values());
};

export const indexArchitecture = (targetDir = 'src', cwd = process.cwd()) => {
  const db = openIndexDb(cwd);
  const relTarget = targetDir.replace(/^\.?\//, '').replace(/\/$/, '');
  const likePattern = relTarget ? `${relTarget}/%` : '%';

  const hasDb = Boolean(db);
  if (!hasDb) {
    const fallbackCapsules = discoverCapsulesFromFs(targetDir, cwd);
    return {
      targetDir: relTarget || '.',
      totalCapsules: fallbackCapsules.length,
      totalLines: fallbackCapsules.reduce((sum, c) => sum + c.lines, 0),
      capsules: fallbackCapsules
    };
  }

  try {
    const filesStmt = db.prepare(`
      SELECT path, tier, lines, health_score, hazard_count
      FROM files
      WHERE path LIKE ? OR path = ?
      ORDER BY path ASC
    `);

    const symbolsStmt = db.prepare(`
      SELECT file_path, name, kind
      FROM symbols
      WHERE (file_path LIKE ? OR file_path = ?) AND is_export = 1
    `);

    const consumerCountStmt = db.prepare(`
      SELECT resolved_path, COUNT(DISTINCT importer_path) as consumers
      FROM imports
      WHERE (resolved_path LIKE ? OR resolved_path = ?)
      GROUP BY resolved_path
    `);

    const fileRows = filesStmt.all(likePattern, relTarget);
    const hasRows = fileRows.length > 0;
    if (!hasRows) {
      const fallbackCapsules = discoverCapsulesFromFs(targetDir, cwd);
      return {
        targetDir: relTarget || '.',
        totalCapsules: fallbackCapsules.length,
        totalLines: fallbackCapsules.reduce((sum, c) => sum + c.lines, 0),
        capsules: fallbackCapsules
      };
    }

    const symbolRows = symbolsStmt.all(likePattern, relTarget);
    const symbolsByFile = new Map();
    for (const s of symbolRows) {
      const list = symbolsByFile.get(s.file_path) || [];
      list.push({ name: s.name, kind: s.kind });
      symbolsByFile.set(s.file_path, list);
    }

    const consumerRows = consumerCountStmt.all(likePattern, relTarget);
    const consumersByPath = new Map();
    for (const c of consumerRows) {
      consumersByPath.set(c.resolved_path, Number(c.consumers || 0));
    }

    const capsuleMap = new Map();
    for (const row of fileRows) {
      const filePath = row.path;
      const dir = path.dirname(filePath);
      const dirName = path.basename(dir);
      const isCapsuleFolder = dirName.startsWith('m-') || dirName.startsWith('o-') || dirName.startsWith('a-');
      const capsuleKey = isCapsuleFolder ? dir : filePath;
      const capsuleName = isCapsuleFolder ? dirName : path.basename(filePath, path.extname(filePath));

      const existing = capsuleMap.get(capsuleKey) || {
        name: capsuleName,
        path: capsuleKey,
        tier: normalizeTierName(row.tier || inferFileTier(filePath)),
        lines: 0,
        files: [],
        exports: [],
        consumers: 0,
        hazardCount: 0
      };

      existing.lines += Number(row.lines || 0);
      existing.files.push(filePath);
      existing.hazardCount += Number(row.hazard_count || 0);
      const fileConsumers = consumersByPath.get(filePath) || 0;
      existing.consumers += fileConsumers;

      const fileSymbols = symbolsByFile.get(filePath) || [];
      for (const sym of fileSymbols) {
        existing.exports.push(sym.name);
      }

      capsuleMap.set(capsuleKey, existing);
    }

    const capsules = Array.from(capsuleMap.values());
    const totalLines = capsules.reduce((sum, c) => sum + c.lines, 0);

    return {
      targetDir: relTarget || '.',
      totalCapsules: capsules.length,
      totalLines,
      capsules
    };
  } catch {
    const fallbackCapsules = discoverCapsulesFromFs(targetDir, cwd);
    return {
      targetDir: relTarget || '.',
      totalCapsules: fallbackCapsules.length,
      totalLines: fallbackCapsules.reduce((sum, c) => sum + c.lines, 0),
      capsules: fallbackCapsules
    };
  }
};

export const resolveCapsuleForIntent = (capsules = [], intentText = '') => {
  const cleanTokens = intentText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const hasTokens = cleanTokens.length > 0;
  if (!hasTokens) return null;

  let bestMatch = null;
  let highestScore = 0;
  let matchedTokens = [];

  for (const cap of capsules) {
    let score = 0;
    const currentHits = [];
    const capName = cap.name.toLowerCase();
    const capPath = cap.path.toLowerCase();
    const exportNames = (cap.exports || []).map((e) => e.toLowerCase());

    for (const token of cleanTokens) {
      const isNameHit = capName.includes(token);
      if (isNameHit) {
        score += 15;
        currentHits.push(token);
      }

      const isPathHit = capPath.includes(token);
      const isPathOnlyHit = isPathHit && !isNameHit;
      if (isPathOnlyHit) {
        score += 8;
        currentHits.push(token);
      }

      const isExportHit = exportNames.some((exp) => exp.includes(token));
      if (isExportHit) {
        score += 10;
        currentHits.push(token);
      }
    }

    const isHigherScore = score > highestScore;
    if (isHigherScore) {
      highestScore = score;
      bestMatch = cap;
      matchedTokens = Array.from(new Set(currentHits));
    }
  }

  const hasWinner = Boolean(bestMatch && highestScore > 0);
  if (!hasWinner) return null;

  const primaryController = bestMatch.files.find((f) => f.includes('controller')) || bestMatch.files[0];

  return {
    capsule: bestMatch,
    score: highestScore,
    matchedTokens,
    targetFile: primaryController,
    rationale: `Matched keywords [${matchedTokens.join(', ')}] in capsule name and contracts.`
  };
};
