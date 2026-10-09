// Spec preload (node --import): records network attempts to $CHEMX_NETWORK_LOG instead of performing them.
// Covers global fetch and child-process launches of gh, curl and wget.
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const logFile = process.env.CHEMX_NETWORK_LOG;
const NETWORK_BINARIES = new Set(['gh', 'curl', 'wget']);

const record = (event) => {
  const hasLog = Boolean(logFile);
  if (hasLog) fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`);
};

globalThis.fetch = async (url) => {
  record({ kind: 'fetch', url: String(url) });
  throw new Error('network disabled by spec recorder');
};

const isNetworkBinary = (command) => NETWORK_BINARIES.has(String(command).split(/[\\/]/).pop());

const wrap = (name, fakeResult) => {
  const original = childProcess[name];
  childProcess[name] = (command, ...rest) => {
    const isBlocked = isNetworkBinary(command);
    if (!isBlocked) return original(command, ...rest);
    record({ kind: name, command: String(command), args: Array.isArray(rest[0]) ? rest[0] : [] });
    return fakeResult();
  };
};

wrap('spawnSync', () => ({ status: 1, stdout: '', stderr: 'blocked by spec recorder', error: null, signal: null, output: [] }));
wrap('execFileSync', () => { throw new Error('blocked by spec recorder'); });
syncBuiltinESMExports();
