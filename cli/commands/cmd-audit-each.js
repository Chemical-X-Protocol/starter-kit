// `chemx audit --each[=submodules|workspaces]`: audits every git submodule or workspace package
// in turn, each as its own run, so each gets a scoped history snapshot and status.json entry
// (read them back with `chemx audit --feed=scopes`). Each package runs in a child `chemx audit
// <dir> --json`, one at a time unless --concurrency=N, so a batch doesn't swamp a busy machine.
// Exit 1 when any package's gate fails or its audit errors; 2 for an unknown kind.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listWorkspacePackages } from '../workspace.js';

export const EACH_KINDS = ['submodules', 'workspaces'];
const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const flagValue = (args, name) => {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
};

const toConcurrency = (raw) => {
  const parsed = Number(raw);
  const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
  return isPositiveInteger ? parsed : 1;
};

export const parseEachArgs = (args) => ({
  kind: flagValue(args, 'each') || 'submodules',
  concurrency: toConcurrency(flagValue(args, 'concurrency')),
  isJson: args.includes('--json')
});

const isDirectory = (abs) => {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
};

export const listSubmodulePaths = (root) => {
  const res = spawnSync('git', ['config', '-f', '.gitmodules', '--get-regexp', '\\.path$'], { cwd: root, encoding: 'utf-8' });
  const hasListing = res.status === 0;
  if (!hasListing) return [];
  return res.stdout.split('\n')
    .map((line) => line.trim().split(/\s+/).slice(1).join(' '))
    .filter((rel) => rel.length > 0 && isDirectory(path.join(root, rel)));
};

const listTargets = (kind, root) => {
  const isSubmodules = kind === 'submodules';
  if (isSubmodules) return listSubmodulePaths(root);
  return listWorkspacePackages(root).map((pkg) => pkg.rel).filter((rel) => Boolean(rel) && rel !== '.');
};

const lastLine = (text = '') => text.trim().split('\n').filter(Boolean).at(-1) ?? '';

export const summarizeAudit = (scope, { json, seconds, exitCode, stderr = '' }) => {
  const rounded = Math.round(seconds * 10) / 10;
  const hasSummary = json !== null && typeof json === 'object';
  if (!hasSummary) {
    return { scope, files: null, loc: null, healthScore: null, grade: null, aiSlopScore: null, critical: null, highMedium: null, low: null, gatePassing: null, seconds: rounded, note: `audit failed (exit ${exitCode}): ${lastLine(stderr)}` };
  }
  const hasCode = (json.files ?? 0) > 0;
  const graded = (value) => (hasCode ? value ?? null : null);
  return {
    scope,
    files: json.files ?? null,
    loc: json.loc ?? null,
    healthScore: graded(json.health?.score),
    grade: graded(json.health?.grade),
    aiSlopScore: graded(json.aiSlop?.score),
    critical: json.hazards?.critical ?? null,
    highMedium: json.hazards?.highMedium ?? null,
    low: json.hazards?.low ?? null,
    gatePassing: graded(json.gate?.passing),
    seconds: rounded,
    note: hasCode ? null : 'no auditable files'
  };
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// One child `chemx audit <dir> --json` from the project root, so its history lands in the root's
// .chemx with the package's relative dir as scope.
const auditInChild = (target, cwd) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [CLI_PATH, 'audit', target, '--json'], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (exitCode) => resolve({ json: parseJson(stdout), seconds: (Date.now() - started) / 1000, exitCode, stderr }));
});

export const runPool = async (targets, work, concurrency = 1) => {
  const results = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const index = next;
      next += 1;
      results[index] = await work(targets[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
};

const show = (value) => (value === null || value === undefined ? '-' : String(value));
const gateWord = (row) => {
  const isPass = row.gatePassing === true;
  const isFail = row.gatePassing === false;
  if (isPass) return 'pass';
  if (isFail) return 'fail';
  return '-';
};

const TABLE_COLUMNS = [
  ['scope', (r) => r.scope], ['files', (r) => show(r.files)], ['score', (r) => show(r.healthScore)], ['grade', (r) => show(r.grade)],
  ['gate', gateWord], ['critical', (r) => show(r.critical)], ['high/med', (r) => show(r.highMedium)], ['secs', (r) => show(r.seconds)], ['note', (r) => r.note ?? '']
];

export const formatEachTable = (rows) => {
  const cells = rows.map((row) => TABLE_COLUMNS.map(([, read]) => read(row)));
  const widths = TABLE_COLUMNS.map(([title], i) => Math.max(title.length, ...cells.map((line) => line[i].length)));
  const render = (line) => line.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  const passing = rows.filter((r) => r.gatePassing === true).length;
  const failing = rows.filter((r) => r.gatePassing === false).length;
  const footer = `${rows.length} audited, ${passing} passing, ${failing} failing. History: chemx audit --feed=scopes`;
  return `${[render(TABLE_COLUMNS.map(([title]) => title)), ...cells.map(render), footer].join('\n')}\n`;
};

const defaultIo = {
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text)
};

export const runAuditEachCommand = async (args, { cwd = process.cwd(), auditOne = auditInChild, ...io } = {}) => {
  const { write, writeError } = { ...defaultIo, ...io };
  const { kind, concurrency, isJson } = parseEachArgs(args);
  const isKnownKind = EACH_KINDS.includes(kind);
  if (!isKnownKind) {
    writeError(`Unknown --each kind "${kind}". Use one of: ${EACH_KINDS.join(', ')}.\n`);
    return { code: 2 };
  }
  const targets = listTargets(kind, cwd);
  const hasTargets = targets.length > 0;
  if (!hasTargets) {
    write(isJson ? '[]\n' : `No ${kind} found under ${cwd}.\n`);
    return { code: 0 };
  }
  const outcomes = await runPool(targets, (target) => auditOne(target, cwd), concurrency);
  const rows = outcomes.map((outcome, i) => summarizeAudit(targets[i], outcome));
  write(isJson ? `${JSON.stringify(rows)}\n` : formatEachTable(rows));
  const hasFailure = rows.some((r) => r.gatePassing === false || r.note?.startsWith('audit failed'));
  return { code: hasFailure ? 1 : 0, rows };
};
