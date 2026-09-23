import fs from 'node:fs';
import path from 'node:path';
import { runAudit as executeAstAudit } from '../audit.js';
import { runAutofix } from '../audit/autofix.js';
import { resolveTargetCwd } from './tools-search.js';

export const handleQueryPatterns = (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetDir = args.dir || (fs.existsSync(path.resolve(baseCwd, 'src')) ? 'src' : '.');
  const resolvedTarget = path.isAbsolute(targetDir) ? targetDir : path.resolve(baseCwd, targetDir);
  const report = executeAstAudit(resolvedTarget, { cwd: baseCwd });
  const rawPatterns = report.patterns || [];
  const filterType = args.type || 'ALL';
  const minOccurrences = typeof args.minOccurrences === 'number' ? args.minOccurrences : 2;
  const isCompact = args.compact !== false;

  const matchesType = (p) => filterType === 'ALL' || p.type === filterType;
  const matchesCount = (p) => p.fileCount >= minOccurrences;

  const candidates = rawPatterns
    .filter((p) => matchesType(p) && matchesCount(p))
    .map((p) => {
      const base = {
        id: p.id,
        type: p.type,
        label: p.label,
        detail: p.detail,
        suggestedCapsule: p.suggestedCapsule,
        recommendation: p.recommendation,
        fileCount: p.fileCount,
        totalHits: p.totalHits,
        impactScore: p.impactScore
      };

      if (isCompact) {
        const sampleOccurrences = [];
        const seenSampleFiles = new Set();
        for (const occ of (p.occurrences || [])) {
          if (!seenSampleFiles.has(occ.filePath)) {
            seenSampleFiles.add(occ.filePath);
            sampleOccurrences.push({ file: occ.filePath, line: occ.line });
            if (sampleOccurrences.length >= 3) break;
          }
        }
        return {
          ...base,
          files: p.uniqueFiles || Array.from(new Set((p.occurrences || []).map((o) => o.filePath))),
          sampleOccurrences
        };
      }
      return { ...base, occurrences: p.occurrences };
    });

  return {
    scannedDir: targetDir,
    totalCandidates: candidates.length,
    compact: isCompact,
    candidates
  };
};

export const handleAutofix = (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const rawTarget = args.path || args.dir || (fs.existsSync(path.resolve(baseCwd, 'src')) ? 'src' : '.');
  const targetDir = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(baseCwd, rawTarget);
  return runAutofix(targetDir, {
    dryRun: Boolean(args.dryRun),
    rules: args.rules,
    cwd: baseCwd
  });
};
