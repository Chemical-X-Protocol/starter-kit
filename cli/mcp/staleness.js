// Detects a long-running MCP server whose code on disk has moved on (new version or edited cli/).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KIT_ROOT, LOADED_VERSION, readPackageVersion } from './server-info.js';

const CLI_DIR = path.join(KIT_ROOT, 'cli');
const isSourceFile = (name) => name.endsWith('.js') && !name.endsWith('.spec.js');

const collectSourceStats = (dir, out) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceStats(abs, out);
    else if (isSourceFile(entry.name)) {
      const stat = fs.statSync(abs);
      out.push(`${path.relative(CLI_DIR, abs)}:${stat.size}:${stat.mtimeMs}`);
    }
  }
  return out;
};

export const fingerprintCliSources = (dir = CLI_DIR) => crypto
  .createHash('sha1')
  .update(collectSourceStats(dir, []).sort().join('\n'))
  .digest('hex')
  .slice(0, 12);

const defaultProbe = () => ({ version: readPackageVersion(), fingerprint: fingerprintCliSources() });

export const createStalenessProbe = ({ readDisk = defaultProbe, loaded = null, ttlMs = 2000, now = Date.now } = {}) => {
  const baseline = loaded ?? { version: LOADED_VERSION, fingerprint: readDisk().fingerprint };
  let cached = null;
  let checkedAt = -Infinity;
  const check = () => {
    const isFresh = now() - checkedAt < ttlMs;
    if (isFresh) return cached;
    checkedAt = now();
    const disk = readDisk();
    const isVersionChanged = disk.version !== baseline.version;
    const isSourceChanged = disk.fingerprint !== baseline.fingerprint;
    const isStale = isVersionChanged || isSourceChanged;
    const diskLabel = isVersionChanged ? disk.version : `${disk.version} with changed cli/ sources`;
    cached = isStale ? `stale chemx MCP server (loaded ${baseline.version}, disk ${diskLabel}): reconnect via /mcp` : null;
    return cached;
  };
  return { check };
};
