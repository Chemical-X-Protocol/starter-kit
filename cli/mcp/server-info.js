// Identity of the running chemx MCP server: version read from package.json, never hardcoded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const SERVER_INFO = Object.freeze({ name: 'chemical-x-mcp', version: LOADED_VERSION });

export const describeServerOrigin = () => `chemx MCP v${LOADED_VERSION} from ${path.join(KIT_ROOT, 'cli')}`;
