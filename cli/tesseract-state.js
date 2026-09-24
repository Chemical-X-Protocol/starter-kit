/**
 * tesseract-state.js: Codebase and swarm cognitive state snapshot.
 * Single responsibility: Extract AST topology, tiers, hazards, and swarm data.
 */

import { openIndexDb, getIndexStats, queryViolations } from './search-db.js';
import { getSwarmStatus } from './team/team-db.js';

const getTierDistribution = (db) => {
  if (!db) return {};
  try {
    const rows = db.prepare('SELECT tier, COUNT(*) as count FROM files GROUP BY tier').all();
    return Object.fromEntries(rows.map((r) => [r.tier, Number(r.count)]));
  } catch {
    return {};
  }
};

const getRecentCriticalHazards = (db) => {
  if (!db) return [];
  try {
    return queryViolations(db, { limit: 5 });
  } catch {
    return [];
  }
};

export const getTesseractState = (cwd = process.cwd()) => {
  try {
    const db = openIndexDb(cwd);
    const hasDb = Boolean(db);

    const stats = hasDb ? getIndexStats(db) : {
      totalFiles: 0, totalSymbols: 0, totalProps: 0,
      totalHooks: 0, totalImports: 0, totalViolations: 0
    };

    const tiers = hasDb ? getTierDistribution(db) : {};
    const hazards = hasDb ? getRecentCriticalHazards(db) : [];
    const swarm = hasDb ? getSwarmStatus(db) : null;

    return {
      connected: hasDb,
      stats,
      tiers,
      hazards,
      swarm
    };
  } catch {
    return {
      connected: false,
      stats: { totalFiles: 0, totalSymbols: 0, totalProps: 0, totalHooks: 0, totalImports: 0, totalViolations: 0 },
      tiers: {},
      hazards: [],
      swarm: null
    };
  }
};
