// How a generated capsule reaches the a-button atom: a published atoms package is a named import,
// a local atoms directory is a default import of the atom file by relative path (no alias needed).
import fs from 'node:fs';
import path from 'node:path';

const ATOM_FILES = { react: 'a-button.tsx', vue: 'a-button.vue', svelte: 'a-button.svelte' };

// The specifier a capsule written into targetDir uses for the local atom, or null when the
// directory has no a-button for that framework (the capsule then keeps a raw button).
export const resolveLocalAtomPath = ({ atomsDir, targetDir, framework }) => {
  const file = ATOM_FILES[framework];
  const hasCandidate = Boolean(atomsDir) && Boolean(file);
  if (!hasCandidate) return null;
  const absolute = path.join(atomsDir, file);
  const exists = fs.existsSync(absolute);
  if (!exists) return null;
  const relative = path.relative(targetDir, absolute).split(path.sep).join('/');
  const specifier = relative.startsWith('.') ? relative : `./${relative}`;
  const isReact = framework === 'react';
  return isReact ? specifier.replace(/\.tsx$/, '') : specifier;
};

export const hasAtomSource = ({ atomsPackage = null, atomsPath = null } = {}) => Boolean(atomsPackage || atomsPath);

// The import line for the component's script block ('' when there is nothing to import).
export const buildAtomImport = ({ framework, atomsPackage = null, atomsPath = null }) => {
  const isVue = framework === 'vue';
  if (atomsPackage) return isVue ? '' : `import { AtomButton } from '${atomsPackage}';\n`;
  if (atomsPath) return isVue ? `import AButton from '${atomsPath}';\n` : `import AtomButton from '${atomsPath}';\n`;
  return '';
};
