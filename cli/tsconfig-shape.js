// Reads just enough of tsconfig.json to tell what a plain `--noEmit` run would check.
import fs from 'node:fs';
import path from 'node:path';

// tsconfig.json is JSONC; strip comments and trailing commas. An unreadable file is not solution-style.
export const readTsconfig = (cwd) => {
  try {
    const text = fs.readFileSync(path.join(cwd, 'tsconfig.json'), 'utf8');
    const json = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(json);
  } catch {
    return null;
  }
};

// `files: []` plus references (create-vue, Vite templates): `--noEmit` on it checks no file at all.
export const isSolutionStyle = (tsconfig) => {
  const hasNoOwnFiles = Array.isArray(tsconfig?.files) && tsconfig.files.length === 0 && !tsconfig.include;
  return hasNoOwnFiles && Array.isArray(tsconfig.references) && tsconfig.references.length > 0;
};
