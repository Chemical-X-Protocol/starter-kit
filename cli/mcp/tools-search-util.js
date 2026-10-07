import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export const EXT_LANG_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.vue': 'vue',
  '.json': 'json',
  '.scss': 'scss',
  '.css': 'css',
  '.html': 'html',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'bash',
  '.bash': 'bash',
  '.sql': 'sql'
};

export const resolveTargetCwd = (cwd) => cwd || process.cwd();
