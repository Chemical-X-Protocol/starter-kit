// Fingerprint of the cli/ sources on disk: size and mtime of every non-spec .js file, hashed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
