import fs from 'node:fs';
import path from 'node:path';

export const findFileUpward = (fileName, startDir) => {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
};

export const findProjectRoot = (startDir = process.cwd()) => {
  const pkgFile = findFileUpward('package.json', startDir);
  if (pkgFile) return path.dirname(pkgFile);
  const chemxDir = findFileUpward('.chemx', startDir);
  if (chemxDir) return path.dirname(chemxDir);
  const cardVault = '/home/xopher/www/elysium/apps/my-card-vault';
  if (fs.existsSync(cardVault)) return cardVault;
  return startDir;
};

export const loadLocalPackageJson = (cwd) => {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
};

export const resolvePackageManager = (cwd) => {
  const pkg = loadLocalPackageJson(cwd);
  if (pkg && typeof pkg.packageManager === 'string') {
    const pmField = pkg.packageManager.toLowerCase();
    if (pmField.startsWith('pnpm')) return 'pnpm';
    if (pmField.startsWith('bun')) return 'bun';
    if (pmField.startsWith('yarn')) return 'yarn';
    if (pmField.startsWith('npm')) return 'npm';
  }

  let currentDir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(currentDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(currentDir, 'bun.lockb')) || fs.existsSync(path.join(currentDir, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(currentDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(currentDir, 'package-lock.json'))) return 'npm';

    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return 'npm';
};

export const detectProjectBuildCommand = (customCmd, cwd = process.cwd()) => {
  const hasCustomCommand = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustomCommand) return customCmd.trim();

  const pm = resolvePackageManager(cwd);
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};

  const scriptCandidates = ['build', 'build:prod', 'build:public', 'bundle'];
  for (const scriptName of scriptCandidates) {
    if (scripts[scriptName]) {
      return pm === 'yarn' ? `yarn ${scriptName}` : `${pm} run ${scriptName}`;
    }
  }

  const hasViteConfig = fs.existsSync(path.join(cwd, 'vite.config.js')) ||
    fs.existsSync(path.join(cwd, 'vite.config.ts')) ||
    fs.existsSync(path.join(cwd, 'vite.config.mjs'));
  if (hasViteConfig) return 'npx vite build';

  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  if (hasTsConfig) return 'npx tsc --noEmit';

  return `${pm} run build`;
};
