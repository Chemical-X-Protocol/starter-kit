// Detects a long-running MCP server whose code on disk has moved on (new version or edited cli/).
import { LOADED_VERSION, readPackageVersion } from './server-info.js';
import { fingerprintCliSources } from './fingerprint.js';

export { fingerprintCliSources };

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
