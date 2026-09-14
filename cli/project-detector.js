import fs from 'node:fs';
import path from 'node:path';

export const loadProjectConfig = (cwd = process.cwd()) => {
  const cfgPath = path.resolve(cwd, '.chemx', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {
    return {};
  }
};

export const detectFramework = (cwd = process.cwd()) => {
  const config = loadProjectConfig(cwd);
  if (config.framework) {
    const fw = String(config.framework).toLowerCase();
    if (['react', 'vue', 'svelte'].includes(fw)) return fw;
  }

  const pkgPath = path.resolve(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'react';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (deps.vue || deps.nuxt || deps['@nuxt/kit']) return 'vue';
    if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
    if (deps.react || deps.next) return 'react';
  } catch {
    return 'react';
  }

  return 'react';
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

export const detectTierBaseDir = (tier, cwd = process.cwd()) => {
  const config = loadProjectConfig(cwd);
  if (config.dirs && config.dirs[tier]) {
    const configuredPath = path.resolve(cwd, config.dirs[tier]);
    if (fs.existsSync(configuredPath)) return config.dirs[tier];
  }

  const candidates = TIER_DIRECTORY_MAPS[tier] || TIER_DIRECTORY_MAPS.molecule;
  for (const c of candidates) {
    if (fs.existsSync(path.resolve(cwd, c))) return c;
  }

  return '.';
};
