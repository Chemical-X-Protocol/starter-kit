import path from 'node:path';

export const findSymbolDefinition = (db, symbolName) => {
  if (!db || !symbolName) return null;
  const cleanName = symbolName.trim();
  const row = db.prepare(`
    SELECT s.name, s.kind, s.is_export, s.start_line, s.end_line, s.signature, s.file_path, f.tier, f.lines
    FROM symbols s
    JOIN files f ON s.file_path = f.path
    WHERE s.name = ?
    ORDER BY s.is_export DESC, (f.tier = 'molecule' OR f.tier = 'organism' OR f.tier = 'atom') DESC
    LIMIT 1
  `).get(cleanName);

  if (!row) return null;
  return {
    name: row.name,
    kind: row.kind,
    isExport: Boolean(row.is_export),
    startLine: Number(row.start_line || 1),
    endLine: Number(row.end_line || 1),
    signature: row.signature || '',
    filePath: row.file_path,
    tier: row.tier,
    totalLines: Number(row.lines)
  };
};

export const findSymbolReferences = (db, symbolName) => {
  if (!db || !symbolName) return [];
  const cleanName = symbolName.trim();
  const rows = db.prepare(`
    SELECT i.importer_path, i.imported_symbol, i.source_module, i.line, f.tier
    FROM imports i
    LEFT JOIN files f ON i.importer_path = f.path
    WHERE i.imported_symbol = ?
    ORDER BY i.importer_path ASC, i.line ASC
  `).all(cleanName);

  return rows.map((r) => ({
    importerPath: r.importer_path,
    importedSymbol: r.imported_symbol,
    sourceModule: r.source_module,
    line: Number(r.line || 1),
    tier: r.tier || 'utility'
  }));
};

export const findFileDependencies = (db, filePath) => {
  if (!db || !filePath) return [];
  const rows = db.prepare(`
    SELECT importer_path, imported_symbol, source_module, line
    FROM imports
    WHERE importer_path = ? OR importer_path LIKE ?
    ORDER BY line ASC
  `).all(filePath, `%${filePath}%`);

  return rows.map((r) => ({
    importerPath: r.importer_path,
    importedSymbol: r.imported_symbol,
    sourceModule: r.source_module,
    line: Number(r.line || 1)
  }));
};

export const findFileDependents = (db, filePath) => {
  if (!db || !filePath) return [];
  const baseName = path.basename(filePath).replace(/\.[^.]+$/, '');
  const rows = db.prepare(`
    SELECT DISTINCT i.importer_path, i.imported_symbol, i.source_module, i.line, f.tier
    FROM imports i
    LEFT JOIN files f ON i.importer_path = f.path
    WHERE i.source_module LIKE ? OR i.source_module LIKE ?
    ORDER BY i.importer_path ASC
  `).all(`%/${baseName}%`, `%${baseName}%`);

  return rows.map((r) => ({
    importerPath: r.importer_path,
    importedSymbol: r.imported_symbol,
    sourceModule: r.source_module,
    line: Number(r.line || 1),
    tier: r.tier || 'utility'
  }));
};

export const syncViolationsIndex = (db, violations = []) => {
  if (!db) return 0;
  db.exec('DELETE FROM violations;');
  if (!Array.isArray(violations) || violations.length === 0) return 0;

  const insertStmt = db.prepare(`
    INSERT INTO violations (file_path, rule, severity, pillar, line, hazard, directive)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const v of violations) {
    insertStmt.run(
      v.filePath || '',
      v.rule || '',
      v.severity || 'LOW',
      v.pillar || '',
      v.line || 1,
      v.hazard || '',
      v.directive || ''
    );
  }

  return violations.length;
};

export const queryViolations = (db, options = {}) => {
  if (!db) return [];
  const { rule = null, severity = null, filePath = null, limit = 100 } = options;

  let sql = 'SELECT file_path, rule, severity, pillar, line, hazard, directive FROM violations WHERE 1=1';
  const params = [];

  if (rule) {
    sql += ' AND rule = ?';
    params.push(rule);
  }
  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity.toUpperCase());
  }
  if (filePath) {
    sql += ' AND (file_path = ? OR file_path LIKE ?)';
    params.push(filePath, `%${filePath}%`);
  }

  sql += " ORDER BY (severity = 'CRITICAL') DESC, (severity = 'HIGH') DESC, file_path ASC, line ASC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    filePath: r.file_path,
    rule: r.rule,
    severity: r.severity,
    pillar: r.pillar,
    line: Number(r.line || 1),
    hazard: r.hazard,
    directive: r.directive
  }));
};

export const recordAuditSnapshot = (db, report) => {
  if (!db || !report) return null;
  const timestamp = Date.now();
  const score = Number(report.health?.score || 0);
  const grade = report.health?.grade || 'F';
  const asi = Number(report.aiSlop?.asiScore || 0);
  const totalLoc = Number(report.metrics?.totalLoc || 0);
  const scannedFiles = Number(report.scannedFiles || 0);

  const isCritical = (v) => v.severity === 'CRITICAL';
  const isHighOrMedium = (v) => v.severity === 'HIGH' || v.severity === 'MEDIUM';
  const isLow = (v) => v.severity === 'LOW';

  const violations = report.violations || [];
  const criticalCount = violations.filter(isCritical).length;
  const highMedCount = violations.filter(isHighOrMedium).length;
  const lowCount = violations.filter(isLow).length;

  const insertStmt = db.prepare(`
    INSERT INTO audit_snapshots (
      timestamp, score, grade, asi, total_loc, scanned_files, critical_count, high_med_count, low_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(timestamp, score, grade, asi, totalLoc, scannedFiles, criticalCount, highMedCount, lowCount);

  // Stamp file health in files table
  const hazardCountsByFile = new Map();
  for (const v of report.violations || []) {
    if (v.filePath) {
      const current = hazardCountsByFile.get(v.filePath) || 0;
      hazardCountsByFile.set(v.filePath, current + 1);
    }
  }

  const updateStmt = db.prepare(`
    UPDATE files
    SET health_score = ?, hazard_count = ?
    WHERE path = ?
  `);

  const allFiles = db.prepare('SELECT path FROM files').all() || [];
  for (const f of allFiles) {
    const hazards = hazardCountsByFile.get(f.path) || 0;
    const fileScore = Math.max(0, 100 - hazards * 15);
    updateStmt.run(fileScore, hazards, f.path);
  }

  return { timestamp, score, grade, asi, criticalCount, highMedCount };
};

export const getAuditProgression = (db, limit = 10) => {
  if (!db) return [];
  const rows = db.prepare(`
    SELECT timestamp, score, grade, asi, total_loc, scanned_files, critical_count, high_med_count, low_count
    FROM audit_snapshots
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);

  return rows.reverse().map((r) => ({
    timestamp: Number(r.timestamp),
    score: Number(r.score),
    grade: r.grade,
    asi: Number(r.asi),
    totalLoc: Number(r.total_loc),
    scannedFiles: Number(r.scanned_files),
    criticalCount: Number(r.critical_count),
    highMedCount: Number(r.high_med_count),
    lowCount: Number(r.low_count)
  }));
};

export const queryFilesByHealth = (db, { status = 'all', limit = 50 } = {}) => {
  if (!db) return [];
  let sql = 'SELECT path, tier, lines, chars, health_score, hazard_count FROM files';
  if (status === 'failing' || status === 'degraded') {
    sql += ' WHERE hazard_count > 0 ORDER BY health_score ASC, hazard_count DESC, lines DESC';
  } else if (status === 'crystalline' || status === 'clean') {
    sql += ' WHERE hazard_count = 0 ORDER BY lines ASC';
  } else {
    sql += ' ORDER BY path ASC';
  }
  sql += ' LIMIT ?';

  const rows = db.prepare(sql).all(limit);
  return rows.map((r) => ({
    path: r.path,
    tier: r.tier,
    lines: Number(r.lines),
    chars: Number(r.chars),
    healthScore: Number(r.health_score ?? 100),
    hazardCount: Number(r.hazard_count ?? 0)
  }));
};

export {
  calculateBlastRadius,
  calculateCallTrace,
  calculateBacktrace,
  extractCalleesFromCode
} from './search-queries-graph.js';
export { querySemanticIndex, queryHybridIndex } from './search-queries-semantic.js';


