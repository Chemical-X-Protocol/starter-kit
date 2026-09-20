export const buildReactView = (name, pascalName) => `import React from 'react';
import type { ${pascalName}ViewParams } from './types';

export const ${pascalName}View: React.FC<${pascalName}ViewParams> = ({
  HeaderMolecule,
  MainOrganism,
  FooterMolecule
}) => (
  <main className="${name}">
    {HeaderMolecule}
    {MainOrganism}
    {FooterMolecule}
  </main>
);

export default ${pascalName}View;
`;

export const buildVueView = (name, pascalName) => `<script setup lang="ts">
import type { ${pascalName}ViewParams } from './types';

defineProps<${pascalName}ViewParams>();
</script>

<template>
  <main class="${name}">
    <component :is="HeaderMolecule" />
    <component :is="MainOrganism" />
    <component :is="FooterMolecule" />
  </main>
</template>
`;

export const buildSvelteView = (name, pascalName) => `<script lang="ts">
import type { ${pascalName}ViewParams } from './types';

const {
  HeaderMolecule,
  MainOrganism,
  FooterMolecule
}: ${pascalName}ViewParams = $props();
</script>

<main class="${name}">
  {@render HeaderMolecule?.()}
  {@render MainOrganism?.()}
  {@render FooterMolecule?.()}
</main>
`;

export const buildViewParamsType = (pascalName) => `export interface ${pascalName}ViewParams {
  readonly HeaderMolecule?: unknown;
  readonly MainOrganism?: unknown;
  readonly FooterMolecule?: unknown;
}
`;

export const buildViewIndex = (name, pascalName, ext) => {
  const compExport = ext === 'vue' || ext === 'svelte'
    ? `export { default as ${pascalName}View } from './${name}.${ext}';`
    : `export { ${pascalName}View } from './${name}';`;

  return `${compExport}
export type * from './types';
`;
};

export const buildViewSpec = (name, pascalName, runner = 'node:test') => {
  if (runner === 'vitest') {
    return `import { describe, it, expect } from 'vitest';
import { ${pascalName}View } from './${name}';

describe('${pascalName}View Table of Contents', () => {
  it('is defined as a view component', () => {
    expect(typeof ${pascalName}View).toBe('function');
  });
});
`;
  }
  if (runner === 'jest') {
    return `import { describe, it, expect } from '@jest/globals';
import { ${pascalName}View } from './${name}';

describe('${pascalName}View Table of Contents', () => {
  it('is defined as a view component', () => {
    expect(typeof ${pascalName}View).toBe('function');
  });
});
`;
  }
  return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ${pascalName}View } from './${name}';

describe('${pascalName}View Table of Contents', () => {
  it('is defined as a view component', () => {
    assert.equal(typeof ${pascalName}View, 'function');
  });
});
`;
};
