import fs from 'node:fs';
import path from 'node:path';

export const loadProjectConfig = (cwd = process.cwd()) => {
  const cfgPath = path.resolve(cwd, '.chemx', 'config.json');
  const hasConfig = fs.existsSync(cfgPath);
  if (!hasConfig) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {
    return {};
  }
};

export const normalizeFramework = (val) => {
  if (!val) return null;
  const str = String(val).toLowerCase().trim();
  const isReact = ['react', 'tsx', 'jsx'].includes(str);
  if (isReact) return 'react';
  const isVue = ['vue', 'vue3', 'nuxt'].includes(str);
  if (isVue) return 'vue';
  const isSvelte = ['svelte', 'svelte5', 'kit'].includes(str);
  if (isSvelte) return 'svelte';
  return null;
};

export const resolveFramework = ({ frameworkArg = null, cwd = process.cwd() } = {}) => {
  // 1. Explicit flag
  const explicit = normalizeFramework(frameworkArg);
  if (explicit) return explicit;

  // 2. Project config in .chemx/config.json
  const config = loadProjectConfig(cwd);
  const hasConfiguredFramework = Boolean(config.framework);
  if (hasConfiguredFramework) {
    const fromConfig = normalizeFramework(config.framework);
    if (fromConfig) return fromConfig;
  }

  // 3. Auto-detect from package.json dependencies
  const pkgPath = path.resolve(cwd, 'package.json');
  const hasPackageJson = fs.existsSync(pkgPath);
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      const usesVue = Boolean(deps.vue || deps.nuxt || deps['@nuxt/kit']);
      if (usesVue) return 'vue';
      const usesSvelte = Boolean(deps.svelte || deps['@sveltejs/kit']);
      if (usesSvelte) return 'svelte';
      const usesReact = Boolean(deps.react || deps.next);
      if (usesReact) return 'react';
    } catch {
      // chemx-allow: best-effort an unreadable package.json falls through to the hard default framework
    }
  }

  // 4. Hard default
  return 'react';
};

export const detectFramework = (cwd = process.cwd()) => {
  return resolveFramework({ cwd });
};

export const detectTestRunner = (startDir = process.cwd()) => {
  let curr = path.resolve(startDir);
  for (;;) {
    const hasParentDir = Boolean(curr && curr !== path.dirname(curr));
    if (!hasParentDir) break;
    const pkgPath = path.join(curr, 'package.json');
    const hasPackageJson = fs.existsSync(pkgPath);
    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const usesVitest = Boolean(deps.vitest || (pkg.scripts?.test && pkg.scripts.test.includes('vitest')));
        if (usesVitest) return 'vitest';
        const usesJest = Boolean(deps.jest || (pkg.scripts?.test && pkg.scripts.test.includes('jest')));
        if (usesJest) return 'jest';
      } catch {
        // chemx-allow: best-effort an unreadable package.json falls back to the node:test runner
      }
      break;
    }
    curr = path.dirname(curr);
  }

  return 'node:test';
};

const ATOMS_PACKAGES = ['@chemx/x-atoms', '@chemx/atoms', 'x-atoms', '@chem-x/x-atoms'];
const PALETTE_PACKAGES = ['@chemx/o-command-palette', '@chemx/command-palette', 'o-command-palette', '@chem-x/o-command-palette'];

const resolveLocalAtomsCandidate = (cwd) => {
  const componentAtomsPath = path.resolve(cwd, 'src/components/atoms');
  const hasComponentAtoms = fs.existsSync(componentAtomsPath);
  if (hasComponentAtoms) {
    return '@/components/atoms';
  }

  const directAtomsPath = path.resolve(cwd, 'src/atoms');
  const hasDirectAtoms = fs.existsSync(directAtomsPath);
  if (hasDirectAtoms) {
    return '@/atoms';
  }

  return null;
};

export const detectInstalledFamily = (cwd = process.cwd()) => {
  const pkgPath = path.resolve(cwd, 'package.json');
  const hasPackageJson = fs.existsSync(pkgPath);
  if (!hasPackageJson) {
    return { hasAtoms: false, atomsPackage: null, hasPalette: false, palettePackage: null };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    const atomsCandidate = ATOMS_PACKAGES.find((name) => Boolean(deps[name]));
    const paletteCandidate = PALETTE_PACKAGES.find((name) => Boolean(deps[name]));

    const localAtomsCandidate = resolveLocalAtomsCandidate(cwd);

    const resolvedAtomsPackage = atomsCandidate || localAtomsCandidate || null;

    return {
      hasAtoms: Boolean(resolvedAtomsPackage),
      atomsPackage: resolvedAtomsPackage,
      hasPalette: Boolean(paletteCandidate),
      palettePackage: paletteCandidate || null
    };
  } catch {
    return { hasAtoms: false, atomsPackage: null, hasPalette: false, palettePackage: null };
  }
};

const TIER_DIRECTORY_MAPS = {
  hook: [
    'src/hooks',
    'src/composables',
    'composables',
    'hooks',
    'src/lib/hooks',
    'src'
  ],
  view: [
    'src/views',
    'src/pages',
    'src/routes',
    'src/app',
    'app',
    'pages',
    'views',
    'src'
  ],
  molecule: [
    'src/components/molecules',
    'src/components',
    'src/lib/components',
    'components',
    'src'
  ],
  atom: [
    'src/components/atoms',
    'src/components',
    'src/lib/components',
    'components',
    'src'
  ],
  organism: [
    'src/components/organisms',
    'src/components',
    'src/lib/components',
    'components',
    'src'
  ],
  template: [
    'src/components/templates',
    'src/components',
    'src/lib/components',
    'components',
    'src'
  ]
};

export const PRESET_DIRECTORY_MAPS = {
  src: {
    molecule: 'src/components/molecules',
    atom: 'src/components/atoms',
    organism: 'src/components/organisms',
    template: 'src/components/templates',
    hook: 'src/hooks',
    view: 'src/views',
    service: 'src/services',
    route: 'src/routes',
    store: 'src/stores',
    repo: 'src/repos',
    util: 'src/utils',
    spec: 'test/unit'
  },
  app: {
    molecule: 'app/components/molecules',
    atom: 'app/components/atoms',
    organism: 'app/components/organisms',
    template: 'app/components/templates',
    hook: 'app/composables',
    view: 'app/pages',
    service: 'app/services',
    route: 'server/api',
    store: 'app/stores',
    repo: 'server/repos',
    util: 'app/utils',
    spec: 'test/unit'
  },
  root: {
    molecule: 'components/molecules',
    atom: 'components/atoms',
    organism: 'components/organisms',
    template: 'components/templates',
    hook: 'hooks',
    view: 'pages',
    service: 'services',
    route: 'routes',
    store: 'stores',
    repo: 'repos',
    util: 'utils',
    spec: 'test'
  },
  lib: {
    molecule: 'src/lib/components/molecules',
    atom: 'src/lib/components/atoms',
    organism: 'src/lib/components/organisms',
    template: 'src/lib/components/templates',
    hook: 'src/lib/hooks',
    view: 'src/routes',
    service: 'src/lib/services',
    route: 'src/routes/api',
    store: 'src/lib/stores',
    repo: 'src/lib/repos',
    util: 'src/lib/utils',
    spec: 'test'
  }
};

export const detectTierBaseDir = (tier, cwd = process.cwd(), presetOverride = null) => {
  const config = loadProjectConfig(cwd);
  const activePreset = presetOverride || config.preset;

  const hasPresetDir = Boolean(activePreset && PRESET_DIRECTORY_MAPS[activePreset]?.[tier]);
  if (hasPresetDir) {
    return PRESET_DIRECTORY_MAPS[activePreset][tier];
  }

  const hasConfiguredDir = Boolean(config.dirs && config.dirs[tier]);
  if (hasConfiguredDir) {
    const configuredPath = path.resolve(cwd, config.dirs[tier]);
    const isConfiguredDirPresent = fs.existsSync(configuredPath);
    if (isConfiguredDirPresent) return config.dirs[tier];
  }

  const candidates = TIER_DIRECTORY_MAPS[tier] || TIER_DIRECTORY_MAPS.molecule;
  for (const c of candidates) {
    const isCandidatePresent = fs.existsSync(path.resolve(cwd, c));
    if (isCandidatePresent) return c;
  }

  const hasAppComponents = fs.existsSync(path.resolve(cwd, 'app/components'));
  if (hasAppComponents) {
    return PRESET_DIRECTORY_MAPS.app[tier] || 'app/components';
  }

  return PRESET_DIRECTORY_MAPS.src[tier] || '.';
};

export const detectJigBaseDir = (kind, { cwd = process.cwd(), preset = null } = {}) => {
  const config = loadProjectConfig(cwd);
  const activePreset = preset || config.preset;

  const hasPresetDir = Boolean(activePreset && PRESET_DIRECTORY_MAPS[activePreset]?.[kind]);
  if (hasPresetDir) {
    return PRESET_DIRECTORY_MAPS[activePreset][kind];
  }

  const hasConfiguredDir = Boolean(config.dirs && config.dirs[kind]);
  if (hasConfiguredDir) {
    const configuredPath = path.resolve(cwd, config.dirs[kind]);
    const isConfiguredDirPresent = fs.existsSync(configuredPath);
    if (isConfiguredDirPresent) return config.dirs[kind];
  }

  const defaultDirMap = {
    service: ['src/services', 'app/services', 'services', 'src/lib/services'],
    route: ['src/routes', 'server/api', 'routes', 'src/routes/api'],
    store: ['src/stores', 'app/stores', 'stores', 'src/lib/stores'],
    repo: ['src/repos', 'server/repos', 'repos', 'src/lib/repos'],
    util: ['src/utils', 'app/utils', 'utils', 'src/lib/utils'],
    spec: ['test/unit', 'tests/unit', 'test', 'tests']
  };

  const candidates = defaultDirMap[kind] || [`src/${kind}s`];
  for (const c of candidates) {
    const isCandidatePresent = fs.existsSync(path.resolve(cwd, c));
    if (isCandidatePresent) return c;
  }

  const hasAppDir = fs.existsSync(path.resolve(cwd, 'app'));
  if (hasAppDir) {
    return PRESET_DIRECTORY_MAPS.app[kind] || `app/${kind}s`;
  }

  return PRESET_DIRECTORY_MAPS.src[kind] || `src/${kind}s`;
};

const TAILWIND_PACKAGES = [
  'tailwindcss',
  '@tailwindcss/vite',
  '@tailwindcss/postcss',
  '@tailwindcss/cli'
];

const SCSS_PACKAGES = ['sass', 'sass-embedded'];

const TAILWIND_CONFIG_NAMES = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'tailwind.config.mjs'
];

export const detectStylingStack = (cwd = process.cwd()) => {
  const pkgPath = path.resolve(cwd, 'package.json');
  let hasTailwind = false;
  let hasScss = false;

  const hasPackageJson = fs.existsSync(pkgPath);
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      hasTailwind = TAILWIND_PACKAGES.some((pkgName) => Boolean(deps[pkgName]));
      hasScss = SCSS_PACKAGES.some((pkgName) => Boolean(deps[pkgName]));
    } catch {
      // chemx-allow: best-effort an unreadable package.json leaves styling detection to the tailwind config probe
    }
  }

  if (!hasTailwind) {
    hasTailwind = TAILWIND_CONFIG_NAMES.some((cfg) => fs.existsSync(path.resolve(cwd, cfg)));
  }

  let styleFlavor = 'css';
  if (hasTailwind) {
    styleFlavor = 'tailwind';
  } else if (hasScss) {
    styleFlavor = 'scss';
  }

  return { hasTailwind, hasScss, styleFlavor };
};
