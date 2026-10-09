// Read-only /proc scan for running chemx MCP servers (Linux). For each: pid, script, kit version,
// project root (CHEMX_PROJECT_ROOT or cwd) and whether the kit code changed after the process started.

import fs from 'node:fs';
import path from 'node:path';
import { locateKit } from './kit-locate.js';

const MCP_SUBCOMMANDS = new Set(['mcp', 'mcp-server', 'server']);
const CHEMX_SCRIPT = /(?:cli\/index\.js|\/(?:chemx|cx|cmx|chem-x|chemical-x))$/;
const KIT_CODE_FILES = ['package.json', 'cli/index.js', 'cli/mcp/server.js', 'cli/mcp/index.js', 'cli/mcp/tools.js'];

const readOrNull = (file, encoding = 'utf-8') => {
  try {
    return fs.readFileSync(file, encoding);
  } catch {
    return null; // processes owned by other users or already gone are skipped
  }
};

export const parseMcpCommandLine = (argv) => {
  const isNode = path.basename(argv[0] ?? '') === 'node' || /\/node$/.test(argv[0] ?? '');
  if (!isNode) return null;
  const scriptIndex = argv.findIndex((arg, index) => index > 0 && CHEMX_SCRIPT.test(arg));
  const hasScript = scriptIndex !== -1;
  const isMcp = hasScript && MCP_SUBCOMMANDS.has(argv[scriptIndex + 1]);
  return isMcp ? { script: argv[scriptIndex] } : null;
};

const kitCodeMtime = (kitRoot) => Math.max(0, ...KIT_CODE_FILES.map((rel) => {
  const file = path.join(kitRoot, rel);
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}));

const readProcess = (procRoot, pid) => {
  const cmdline = readOrNull(path.join(procRoot, pid, 'cmdline'));
  if (!cmdline) return null;
  const argv = cmdline.split('\0').filter(Boolean);
  const match = parseMcpCommandLine(argv);
  if (!match) return null;
  const cwdLink = path.join(procRoot, pid, 'cwd');
  const cwd = fs.existsSync(cwdLink) ? fs.readlinkSync(cwdLink) : null;
  const environ = readOrNull(path.join(procRoot, pid, 'environ')) ?? '';
  const envRoot = environ.split('\0').find((entry) => entry.startsWith('CHEMX_PROJECT_ROOT='))?.slice('CHEMX_PROJECT_ROOT='.length);
  const script = path.isAbsolute(match.script) || !cwd ? match.script : path.resolve(cwd, match.script);
  const kit = locateKit(script);
  const startedAt = fs.statSync(path.join(procRoot, pid)).ctimeMs;
  const isStale = kit ? kitCodeMtime(kit.root) > startedAt : false;
  return { pid: Number(pid), script, version: kit?.version ?? null, root: envRoot ?? cwd, startedAt, isStale };
};

// A process can exit between readdir and stat; treat it as gone rather than failing the scan.
const readProcessSafely = (procRoot, pid) => {
  try {
    return readProcess(procRoot, pid);
  } catch {
    return null; // vanished or unreadable process
  }
};

export const listChemxMcpProcesses = (procRoot = '/proc') => {
  const hasProc = fs.existsSync(procRoot);
  if (!hasProc) return { ok: false, reason: `${procRoot} not available on this platform`, processes: [] };
  const pids = fs.readdirSync(procRoot).filter((entry) => /^\d+$/.test(entry));
  const processes = pids.map((pid) => readProcessSafely(procRoot, pid)).filter(Boolean);
  return { ok: true, processes };
};
