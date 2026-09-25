import path from 'node:path';
import { normalizeFramework } from './project-detector.js';

export const SUPPORTED_FRAMEWORKS = ['react', 'vue', 'svelte'];

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
    devDeps: {
      '@vue/test-utils': '^2.4.6',
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
      'shims-vue.d.ts',
      'atoms/a-button.vue',
      'view-template.vue',
      'molecule-capsule/_m-sample-card.scss',
      'molecule-capsule/index.ts',
      'molecule-capsule/types.d.ts',
      'molecule-capsule/m-sample-card.vue',
      'molecule-capsule/m-chemx-badge/_m-chemx-badge.scss',
      'molecule-capsule/m-chemx-badge/index.ts',
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
      'atoms/a-button.svelte',
      'view-template.svelte',
      'molecule-capsule/_m-sample-card.scss',
      'molecule-capsule/index.ts',
      'molecule-capsule/types.d.ts',
      'molecule-capsule/m-sample-card.svelte',
      'molecule-capsule/m-chemx-badge/_m-chemx-badge.scss',
      'molecule-capsule/m-chemx-badge/index.ts',
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
