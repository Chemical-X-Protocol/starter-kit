/**
 * Chemical X UI Action Handlers: Codebase Explorer & Symbol Inspector
 */
import { lineLimitFor } from './audit/line-budgets.js';
import { loadProjectConfig } from './config/index.js';

const budgetRules = (cwd) => (cwd ? loadProjectConfig(cwd).rules : {});

/** Line count plus the file's own limit from line-budgets.js, so the UI never hard-codes one. */
const withLineBudget = (filePath, lines, rules) => {
  const lineLimit = lineLimitFor(filePath, rules);
  return { lines, lineLimit, isOverBudget: lines > lineLimit };
};

export const buildFileTree = (files = []) => {
  const root = { name: 'root', path: '', isFolder: true, children: [] };
  for (const f of files) {
    const parts = (f.path || '').split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      if (isFile) {
        cur.children.push({
          name: parts[i], path: f.path, isFolder: false, lines: Number(f.lines || 0),
          lineLimit: f.lineLimit, isOverBudget: Boolean(f.isOverBudget),
          tier: f.tier || 'utility', healthScore: Number(f.healthScore ?? 100), hazardCount: Number(f.hazardCount ?? 0)
        });
      } else {
        const p = parts.slice(0, i + 1).join('/');
        let folder = cur.children.find((c) => c.isFolder && c.name === parts[i]);
        if (!folder) {
          folder = { name: parts[i], path: p, isFolder: true, children: [] };
          cur.children.push(folder);
        }
        cur = folder;
      }
    }
  }
  return root.children;
};

export const handleCodebaseIndex = (db, cwd = null) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  const rules = budgetRules(cwd);
  const files = db.prepare('SELECT path, tier, lines, health_score, hazard_count FROM files ORDER BY path ASC').all().map((f) => ({
    path: f.path, tier: f.tier || 'utility', ...withLineBudget(f.path, Number(f.lines || 0), rules),
    healthScore: Number(f.health_score ?? 100), hazardCount: Number(f.hazard_count ?? 0)
  }));
  const violations = db.prepare('SELECT file_path, rule, severity, line, hazard, directive FROM violations ORDER BY id DESC LIMIT 50').all().map((v) => ({
    filePath: v.file_path, rule: v.rule, severity: v.severity, line: Number(v.line || 0), hazard: v.hazard, directive: v.directive
  }));
  return { success: true, files, violations };
};

export const handleCodebaseTree = (db, cwd = null) => {
  const res = handleCodebaseIndex(db, cwd);
  if (!res.success) return res;
  return { success: true, tree: buildFileTree(res.files), files: res.files, count: res.files.length };
};

export const handleCodebaseFile = (db, targetPath, cwd = null) => {
  if (!db) return { success: false, error: 'Database unavailable' };
  if (!targetPath) return { success: false, error: 'File path required' };
  const p = targetPath.trim();
  const f = db.prepare('SELECT path, tier, lines, chars, health_score, hazard_count FROM files WHERE path = ?').get(p);
  if (!f) return { success: false, error: 'File not indexed', path: p };

  const symbols = db.prepare('SELECT name, kind, is_export, start_line, end_line, signature FROM symbols WHERE file_path = ? ORDER BY start_line ASC').all(p).map((s) => ({
    name: s.name, kind: s.kind, isExport: Boolean(s.is_export), startLine: Number(s.start_line || 1), endLine: Number(s.end_line || 1), signature: s.signature || ''
  }));
  const imports = db.prepare('SELECT imported_symbol, source_module, line FROM imports WHERE importer_path = ? ORDER BY line ASC').all(p).map((i) => ({
    symbol: i.imported_symbol, source: i.source_module, line: Number(i.line || 1)
  }));
  const base = p.split('/').pop().replace(/\.[^.]+$/, '');
  const connections = db.prepare('SELECT DISTINCT i.importer_path, i.imported_symbol, i.source_module, i.line, f.tier FROM imports i LEFT JOIN files f ON i.importer_path = f.path WHERE i.source_module LIKE ? OR i.source_module LIKE ? ORDER BY i.importer_path ASC').all(`%/${base}%`, `%${base}%`).map((c) => ({
    importerPath: c.importer_path, importedSymbol: c.imported_symbol, sourceModule: c.source_module, line: Number(c.line || 1), tier: c.tier || 'utility'
  }));
  const violations = db.prepare('SELECT rule, severity, line, hazard, directive FROM violations WHERE file_path = ? ORDER BY line ASC').all(p).map((v) => ({
    rule: v.rule, severity: v.severity, line: Number(v.line || 1), hazard: v.hazard, directive: v.directive
  }));

  return {
    success: true,
    file: { path: f.path, tier: f.tier || 'utility', ...withLineBudget(f.path, Number(f.lines || 0), budgetRules(cwd)), healthScore: Number(f.health_score ?? 100), hazardCount: Number(f.hazard_count ?? 0) },
    symbols, exports: symbols.filter((s) => s.isExport), imports, connections, violations
  };
};
