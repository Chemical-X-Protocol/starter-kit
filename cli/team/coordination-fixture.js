/**
 * Spec fixture for #2488: a fake monorepo in a temp dir (never a real checkout).
 *   <root>/.git/ .gitmodules package.json pnpm-workspace.yaml (packages/*)
 *   packages/a   registered submodule with its own .git dir (like the starter-kit)
 *   packages/b   absorbed submodule: .git file pointing into <root>/.git/modules (like apps/youmeos)
 *   packages/c   plain workspace package, no git
 *   loose/       a plain directory of the root repo
 * Only directory markers are written; no git binary runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

export const makeTempDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

export const buildMonorepo = (prefix = 'chemx-coord-') => {
  const root = makeTempDir(prefix);
  fs.mkdirSync(path.join(root, '.git', 'modules', 'packages', 'b'), { recursive: true });
  write(path.join(root, '.gitmodules'), '[submodule "packages/a"]\n\tpath = packages/a\n\turl = ../a.git\n');
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true }));
  write(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  fs.mkdirSync(path.join(root, 'packages', 'a', '.git'), { recursive: true });
  write(path.join(root, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'pkg-a' }));
  write(path.join(root, 'packages', 'a', 'src', 'x.js'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(root, 'packages', 'a', 'deep', 'nested'), { recursive: true });
  write(path.join(root, 'packages', 'b', '.git'), 'gitdir: ../../.git/modules/packages/b\n');
  write(path.join(root, 'packages', 'b', 'package.json'), JSON.stringify({ name: 'pkg-b' }));
  write(path.join(root, 'packages', 'b', 'src', 'y.js'), 'export const y = 1;\n');
  write(path.join(root, 'packages', 'c', 'package.json'), JSON.stringify({ name: 'pkg-c' }));
  fs.mkdirSync(path.join(root, 'loose', 'dir'), { recursive: true });
  return {
    root,
    pkgA: path.join(root, 'packages', 'a'),
    pkgB: path.join(root, 'packages', 'b'),
    pkgC: path.join(root, 'packages', 'c'),
    loose: path.join(root, 'loose', 'dir'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
};

/** A standalone package clone: its own .git dir, no workspace, no superproject. */
export const buildStandalone = (prefix = 'chemx-solo-') => {
  const root = makeTempDir(prefix);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'solo' }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
};
