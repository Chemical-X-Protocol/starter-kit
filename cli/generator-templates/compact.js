/**
 * Compact Single-File Capsule Builder ("Liquid Mode")
 * Bundles types, controller hook, and component view in a single file (< 80 LOC).
 */

import { toPascalCase } from './naming.js';

export const buildCompactReact = (name, pascalName, archetype, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const atomImport = atomsPackage ? `import { AtomButton } from '${atomsPackage}';\n` : '';

  const rawProps = archetype && typeof archetype.buildProps === 'function'
    ? archetype.buildProps(name, pascalName)
    : `export interface ${pascalName}Props {\n  readonly className?: string;\n  readonly children?: ReactNode;\n}\n`;

  const rawState = archetype && typeof archetype.buildState === 'function'
    ? archetype.buildState(name, pascalName)
    : `export interface ${pascalName}State {\n  readonly isActive: boolean;\n}\n`;

  const rawController = archetype && typeof archetype.buildController === 'function'
    ? archetype.buildController(name, pascalName)
    : `export const use${pascalName}Controller = () => {\n  const [isActive, setIsActive] = useState<boolean>(false);\n  return { isActive };\n};\n`;

  const destructure = archetype?.destructure || 'isActive';
  let body = archetype && typeof archetype.buildReactBody === 'function'
    ? archetype.buildReactBody(name, pascalName)
    : `      <div className="${name}__content">\n        {children}\n      </div>`;

  if (atomsPackage) {
    body = body.replace(/<button\b/g, '<AtomButton').replace(/<\/button>/g, '</AtomButton>');
  }

  // Clean redundant imports from inlined controller, props, and state
  const cleanedProps = rawProps
    .replace(/^import\s+.*?;?\n/gm, '')
    .trim();

  const cleanedState = rawState
    .replace(/^import\s+.*?;?\n/gm, '')
    .trim();

  const cleanedController = rawController
    .replace(/^import\s+.*?;?\n/gm, '')
    .trim();

  return `import type { ReactNode } from 'react';
import { useState, useMemo } from 'react';
${atomImport}
// --- Domain Types ---
${cleanedProps}

${cleanedState}

// --- Co-located Controller Hook ---
${cleanedController}

// --- Component View ---
export const ${pascalName} = ({ className = '', children, ...props }: ${pascalName}Props) => {
  const { ${destructure} } = use${pascalName}Controller(props as any);

  return (
    <div className={\`${name} \${className}\`.trim()}>
${body}
    </div>
  );
};

export default ${pascalName};
`;
};

export const buildCompactVue = (name, pascalName, archetype) => {
  const rawProps = archetype && typeof archetype.buildProps === 'function'
    ? archetype.buildProps(name, pascalName)
    : `export interface ${pascalName}Props {\n  readonly className?: string;\n}\n`;

  return `<script setup lang="ts">
import { ref } from 'vue';

${rawProps.trim()}

const props = withDefaults(defineProps<${pascalName}Props>(), {
  className: ''
});

const isActive = ref(false);
const toggle = () => {
  isActive.value = !isActive.value;
};
</script>

<template>
  <div :class="['${name}', props.className]">
    <div class="${name}__content">
      <slot />
    </div>
  </div>
</template>
`;
};

export const buildCompactSvelte = (name, pascalName, archetype) => {
  return `<script lang="ts">
  let { className = '', children } = $props<{ className?: string; children?: any }>();
  let isActive = $state(false);
  const toggle = () => { isActive = !isActive; };
</script>

<div class="${name} {className}">
  {@render children?.()}
</div>
`;
};

export const buildCompactCapsule = ({
  capsuleName,
  pascalName,
  framework = 'react',
  archetype = null,
  atomsPackage = null
}) => {
  const fw = (framework || 'react').toLowerCase();
  if (fw === 'vue') {
    return buildCompactVue(capsuleName, pascalName, archetype);
  }
  if (fw === 'svelte') {
    return buildCompactSvelte(capsuleName, pascalName, archetype);
  }
  return buildCompactReact(capsuleName, pascalName, archetype, { atomsPackage });
};
