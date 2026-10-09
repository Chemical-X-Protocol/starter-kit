// Identity of the running chemx MCP server: version read from package.json, never hardcoded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintCliSources } from './fingerprint.js';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PACKAGE_JSON_PATH = path.join(KIT_ROOT, 'package.json');

export const readPackageVersion = (packageJsonPath = PACKAGE_JSON_PATH) => {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version || 'unknown';
  } catch (err) {
    process.stderr.write(`[mcp] cannot read version from ${packageJsonPath}: ${err.message}\n`);
    return 'unknown';
  }
};

export const LOADED_VERSION = readPackageVersion();

// The cli/ source fingerprint at load time: what this process is actually running.
export const LOADED_FINGERPRINT = fingerprintCliSources();

// serverInfo.version is the package version plus the loaded source fingerprint (e.g. 26.10.9-562+cli.ab12cd34ef56).
export const SERVER_INFO = Object.freeze({ name: 'chemical-x-mcp', version: `${LOADED_VERSION}+cli.${LOADED_FINGERPRINT}` });

export const describeServerOrigin = () => `chemx MCP v${LOADED_VERSION} from ${path.join(KIT_ROOT, 'cli')}`;
