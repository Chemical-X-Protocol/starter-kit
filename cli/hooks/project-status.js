// Cheap project status shared by the session-start card and the statusline: kit version, last audit
// snapshot (it may be a partial scan, so the file count is kept), ratchet ceiling, MCP launch skew and
// stale chemx MCP servers for this root. Every source is optional; missing data stays null.

import fs from 'node:fs';
import path from 'node:path';
import { readKitVersion } from './launcher.js';
import { listChemxMcpProcesses } from '../doctor/proc-scan.js';
import { checkMcpLaunch } from '../doctor/check-mcp.js';

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null; // absent or unreadable status sources are reported as unknown
  }
};

const lastAudit = (root, now) => {
  const history = readJson(path.join(root, '.chemx', 'history.json'));
  const last = Array.isArray(history) ? history[history.length - 1] : null;
  if (!last?.health) return null;
  const ageMinutes = Math.max(0, Math.round((now - new Date(last.timestamp).getTime()) / 60000));
  return { grade: last.health.grade, score: last.health.score, files: last.metrics?.scannedFiles ?? null, ageMinutes };
};

const ratchetSummary = (root) => {
  const ratchet = readJson(path.join(root, 'chemx-ratchet.json'));
  const rules = ratchet?.rules;
  if (!rules) return null;
  const ceiling = Object.values(rules).reduce((sum, count) => sum + Number(count || 0), 0);
  return { scope: ratchet.scope ?? '.', rules: Object.keys(rules).length, ceiling };
};

const staleServersFor = (root, version, procRoot) => {
  const scan = listChemxMcpProcesses(procRoot);
  if (!scan.ok) return null;
  const mine = scan.processes.filter((proc) => proc.root === root);
  return { running: mine.length, stale: mine.filter((proc) => proc.isStale || (proc.version && proc.version !== version)).length };
};

export const collectProjectStatus = ({ root, procRoot = '/proc', now = Date.now() }) => {
  const version = readKitVersion();
  const launch = checkMcpLaunch({ projectRoot: root, cliVersion: version });
  return {
    root,
    version,
    audit: lastAudit(root, now),
    ratchet: ratchetSummary(root),
    mcpLaunch: { ok: launch.status === 'pass', summary: launch.summary },
    servers: staleServersFor(root, version, procRoot),
  };
};

export const formatAge = (minutes) => {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};
