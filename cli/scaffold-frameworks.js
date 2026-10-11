import path from 'node:path';
import { normalizeFramework } from './project-detector.js';

export const SUPPORTED_FRAMEWORKS = ['react', 'vue', 'svelte'];

// Blueprints mirror the kit's source tree; a scaffolded project gets a src/ layout. Directory
// prefixes keep their relative structure, so imports between blueprint files still resolve.
const SCAFFOLD_FILE_TARGETS = {
  '_package.json': 'package.json',
  '_tsconfig.json': 'tsconfig.json',
  '_vitest.config.ts': 'vitest.config.ts',
  '_gitignore': '.gitignore',
  'shims-vue.d.ts': 'src/shims-vue.d.ts',
  'shims-svelte.d.ts': 'src/shims-svelte.d.ts'
};

const SCAFFOLD_DIR_TARGETS = [
  ['molecule-capsule/', 'src/components/m-sample-card/'],
  ['atoms/', 'src/components/atoms/'],
  ['workflows/', '.github/workflows/']
];

const isViewTemplateFile = (rel) => /^_?view-template\./.test(rel);

// A blueprint that differs per framework carries the framework before its extension
// (`index.vue.ts`, `_vitest.config.svelte.ts`); the tag is dropped on the way out, and the
// untagged file is the React one. The framework's own file list picks which variant ships.
const FRAMEWORK_TAG = /\.(?:react|vue|svelte)(\.[^./]+)$/;
export const stripFrameworkTag = (rel) => rel.replace(FRAMEWORK_TAG, '$1');

export const resolveScaffoldTarget = (taggedRel) => {
  const rel = stripFrameworkTag(taggedRel);
  const hasFileTarget = Object.hasOwn(SCAFFOLD_FILE_TARGETS, rel);
  if (hasFileTarget) return SCAFFOLD_FILE_TARGETS[rel];
  if (isViewTemplateFile(rel)) return `src/views/${rel}`;
  const dirTarget = SCAFFOLD_DIR_TARGETS.find(([prefix]) => rel.startsWith(prefix));
  const hasDirTarget = dirTarget !== undefined;
  if (!hasDirTarget) return rel;
  const [prefix, target] = dirTarget;
  return target + rel.slice(prefix.length);
};

export const FRAMEWORK_CONFIGS = {
  react: {
    id: 'react',
    name: 'React 19',
    ext: 'tsx',
    forbiddenExtensions: ['.vue', '.svelte'],
    deps: {
      react: '^19.0.0',
      'react-dom': '^19.0.0'
    },
    devDeps: {
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@types/node': '^22.0.0',
      'create-chemx': 'latest',
      typescript: '^5.4.0',
      vitest: '^1.6.0'
    },
    files: [
      '_tsconfig.json',
      '_vitest.config.ts',
      '_view-template.scss',
      'workflows/chemx-audit.yml',
      'atoms/a-button.tsx',
      'view-template.tsx',
      'molecule-capsule/_m-sample-card.scss',
      'molecule-capsule/index.ts',
      'molecule-capsule/types.d.ts',
      'molecule-capsule/m-sample-card.tsx',
      'molecule-capsule/m-sample-card.spec.ts',
      'molecule-capsule/m-chemx-badge/_m-chemx-badge.scss',
      'molecule-capsule/m-chemx-badge/index.ts',
      'molecule-capsule/m-chemx-badge/types.d.ts',
      'molecule-capsule/m-chemx-badge/m-chemx-badge.tsx',
      'molecule-capsule/m-chemx-badge/m-chemx-badge.spec.ts'
    ]
  },
  vue: {
    id: 'vue',
    name: 'Vue 3.4+',
    ext: 'vue',
    forbiddenExtensions: ['.tsx', '.jsx', '.svelte'],
    deps: {
      vue: '^3.4.0'
    },
    // vite is pinned to the major vitest 1.x bundles, so plugin-vue types against the same copy;
    // sass compiles the SFC <style lang="scss"> blocks under test.
    devDeps: {
      '@vitejs/plugin-vue': '^5.0.0',
      '@vue/test-utils': '^2.4.6',
      '@types/node': '^22.0.0',
      'create-chemx': 'latest',
      jsdom: '^25.0.0',
      sass: '^1.77.0',
      typescript: '^5.4.0',
      vite: '^5.4.0',
      vitest: '^1.6.0'
    },
    files: [
      '_tsconfig.json',
      '_vitest.config.vue.ts',
      '_view-template.scss',
      'workflows/chemx-audit.yml',
      'shims-vue.d.ts',
      'atoms/a-button.vue',
      'view-template.vue',
      'molecule-capsule/_m-sample-card.scss',
      'molecule-capsule/index.vue.ts',
      'molecule-capsule/types.d.ts',
      'molecule-capsule/m-sample-card.vue',
      'molecule-capsule/m-chemx-badge/_m-chemx-badge.scss',
      'molecule-capsule/m-chemx-badge/index.vue.ts',
      'molecule-capsule/m-chemx-badge/types.d.ts',
      'molecule-capsule/m-chemx-badge/m-chemx-badge.vue',
      'molecule-capsule/m-tab-button/_m-tab-button.scss',
      'molecule-capsule/m-tab-button/index.ts',
      'molecule-capsule/m-tab-button/m-tab-button.controller.ts',
      'molecule-capsule/m-tab-button/m-tab-button.vue',
      'molecule-capsule/m-tab-button/m-tab-button.spec.ts',
      'molecule-capsule/m-tab-button/types.d.ts'
    ]
  },
  svelte: {
    id: 'svelte',
    name: 'Svelte 5',
    ext: 'svelte',
    forbiddenExtensions: ['.vue', '.tsx', '.jsx'],
    deps: {
      svelte: '^5.0.0'
    },
    devDeps: {
      '@sveltejs/vite-plugin-svelte': '^4.0.0',
      '@types/node': '^22.0.0',
      'create-chemx': 'latest',
      typescript: '^5.4.0',
      vitest: '^1.6.0'
    },
    files: [
      '_tsconfig.json',
      '_vitest.config.svelte.ts',
      '_view-template.scss',
      'workflows/chemx-audit.yml',
      'shims-svelte.d.ts',
      'atoms/a-button.svelte',
      'view-template.svelte',
      'molecule-capsule/_m-sample-card.scss',
      'molecule-capsule/index.svelte.ts',
      'molecule-capsule/types.d.ts',
      'molecule-capsule/m-sample-card.svelte',
      'molecule-capsule/m-sample-card.spec.svelte.ts',
      'molecule-capsule/m-chemx-badge/_m-chemx-badge.scss',
      'molecule-capsule/m-chemx-badge/index.svelte.ts',
      'molecule-capsule/m-chemx-badge/types.d.ts',
      'molecule-capsule/m-chemx-badge/m-chemx-badge.svelte'
    ]
  }
};

export const getFrameworkConfig = (frameworkId) => {
  const norm = normalizeFramework(frameworkId) || 'react';
  return FRAMEWORK_CONFIGS[norm] || FRAMEWORK_CONFIGS.react;
};

export const buildScaffoldPackageJson = (projectName, frameworkConfig) => ({
  name: projectName || 'chemical-x-app',
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    test: 'vitest run',
    typecheck: 'tsc --noEmit',
    audit: 'chemx audit',
    verify: 'chemx verify'
  },
  dependencies: { ...frameworkConfig.deps },
  devDependencies: { ...frameworkConfig.devDeps }
});
