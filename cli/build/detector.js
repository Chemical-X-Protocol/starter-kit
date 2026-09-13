import fs from 'node:fs';
import path from 'node:path';

const findFileUpward = (fileName, startDir) => {
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

const resolvePackageManager = (cwd) => {
  const hasPnpmLock = Boolean(findFileUpward('pnpm-lock.yaml', cwd));
  const hasYarnLock = Boolean(findFileUpward('yarn.lock', cwd));
  const hasBunLock = Boolean(findFileUpward('bun.lockb', cwd) || findFileUpward('bun.lock', cwd));

  if (hasPnpmLock) return 'pnpm';
  if (hasYarnLock) return 'yarn';
  if (hasBunLock) return 'bun';
  return 'npm';
};

const loadLocalPackageJson = (cwd) => {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
};

export const detectProjectBuildCommand = (customCmd, cwd = process.cwd()) => {
  const hasCustomCommand = Boolean(customCmd && customCmd.trim().length > 0);
  if (hasCustomCommand) return customCmd.trim();

  const pm = resolvePackageManager(cwd);
  const pkg = loadLocalPackageJson(cwd);
  const scripts = (pkg && pkg.scripts) || {};

  const hasBuildScript = Boolean(scripts.build);
  const hasBuildPublicScript = Boolean(scripts['build:public']);
  const hasBuildProdScript = Boolean(scripts['build:prod']);

  if (hasBuildScript) {
    return pm === 'yarn' ? 'yarn build' : `${pm} run build`;
  }
  if (hasBuildPublicScript) {
    return pm === 'yarn' ? 'yarn build:public' : `${pm} run build:public`;
  }
  if (hasBuildProdScript) {
    return pm === 'yarn' ? 'yarn build:prod' : `${pm} run build:prod`;
  }

  const hasViteConfig = fs.existsSync(path.join(cwd, 'vite.config.js')) ||
    fs.existsSync(path.join(cwd, 'vite.config.ts')) ||
    fs.existsSync(path.join(cwd, 'vite.config.mjs'));
  if (hasViteConfig) return 'npx vite build';

  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  if (hasTsConfig) return 'npx tsc --noEmit';

  return `${pm} run build`;
};
