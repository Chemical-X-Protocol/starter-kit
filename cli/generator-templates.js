export const toPascalCase = (str) =>
  str
    .replace(/^(?:[a-z]|use|v)-/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

export const toCamelCase = (str) => {
  const p = toPascalCase(str);
  if (str.startsWith('use-') || str.startsWith('use')) {
    return `use${p}`;
  }
  return p.charAt(0).toLowerCase() + p.slice(1);
};

export const buildReactComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const atomImport = atomsPackage ? `import { AtomButton } from '${atomsPackage}';\n` : '';
  const actionButton = atomsPackage
    ? `        <AtomButton
          disabled={!canProceed}
          onClick={handleAction}
        >
          {variant}
        </AtomButton>`
    : `        <button
          type="button"
          className="${name}__action"
          disabled={!canProceed}
          onClick={handleAction}
        >
          {variant}
        </button>`;

  return `import React from 'react';
${atomImport}import type { ${pascalName}Props } from './types';
import { use${pascalName}Controller } from './${name}.controller';

export const ${pascalName}: React.FC<${pascalName}Props> = ({
  title,
  subtitle,
  variant = 'standard',
  onAction
}) => {
  const { state, canProceed, descriptor, handleAction } = use${pascalName}Controller({
    initialState: { status: 'idle' },
    onAction
  });

  return (
    <div className="${name}">
      <div className="${name}__header">
        <h3 className="${name}__title">{title}</h3>
        {subtitle && <p className="${name}__subtitle">{subtitle}</p>}
        <span className={descriptor.className}>{descriptor.text}</span>
      </div>
      <div className="${name}__body">
${actionButton}
      </div>
    </div>
  );
};

export default ${pascalName};
`;
};

export const buildVueComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const actionButton = atomsPackage
    ? `      <a-button
        :disabled="!canProceed"
        @click="handleAction"
      >
        {{ variant }}
      </a-button>`
    : `      <button
        type="button"
        class="${name}__action"
        :disabled="!canProceed"
        @click="handleAction"
      >
        {{ variant }}
      </button>`;

  return `<script setup lang="ts">
import type { ${pascalName}Props, ${pascalName}Emits } from './types';
import { use${pascalName}Controller } from './${name}.controller';

const props = withDefaults(defineProps<${pascalName}Props>(), {
  variant: 'standard'
});

const emit = defineEmits<${pascalName}Emits>();

const { state, canProceed, descriptor, handleAction } = use${pascalName}Controller({
  initialState: { status: 'idle' },
  onAction: () => emit('action', props.title)
});
</script>

<template>
  <div class="${name}">
    <div class="${name}__header">
      <h3 class="${name}__title">{{ title }}</h3>
      <p v-if="subtitle" class="${name}__subtitle">{{ subtitle }}</p>
      <span :class="descriptor.className">{{ descriptor.text }}</span>
    </div>
    <div class="${name}__body">
${actionButton}
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use './_${name}.scss';
</style>
`;
};

export const buildSvelteComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const atomImport = atomsPackage ? `import { AtomButton } from '${atomsPackage}';\n` : '';
  const actionButton = atomsPackage
    ? `    <AtomButton
      disabled={!controller.canProceed}
      onclick={controller.handleAction}
    >
      {variant}
    </AtomButton>`
    : `    <button
      type="button"
      class="${name}__action"
      disabled={!controller.canProceed}
      onclick={controller.handleAction}
    >
      {variant}
    </button>`;

  return `<script lang="ts">
import type { ${pascalName}Props } from './types';
${atomImport}import { create${pascalName}Controller } from './${name}.controller';

const {
  title,
  subtitle = '',
  variant = 'standard',
  onAction
}: ${pascalName}Props = $props();

const controller = create${pascalName}Controller({
  initialState: { status: 'idle' },
  onAction
});
</script>

<div class="${name}">
  <div class="${name}__header">
    <h3 class="${name}__title">{title}</h3>
    {#if subtitle}
      <p class="${name}__subtitle">{subtitle}</p>
    {/if}
    <span class={controller.descriptor.className}>{controller.descriptor.text}</span>
  </div>
  <div class="${name}__body">
${actionButton}
  </div>
</div>

<style lang="scss">
@use './_${name}.scss';
</style>
`;
};

export const buildController = (name, pascalName) => `import { useState, useMemo } from 'react';
import type { ${pascalName}State, ${pascalName}Descriptor } from './types';

interface ControllerOptions {
  readonly initialState?: ${pascalName}State;
  readonly onAction?: () => void;
}

export const use${pascalName}Controller = (options: ControllerOptions = {}) => {
  const [state, setState] = useState<${pascalName}State>(
    options.initialState || { status: 'idle' }
  );

  const isIdle = state.status === 'idle';
  const isPending = state.status === 'loading';
  const canProceed = isIdle && !isPending;

  const descriptor: ${pascalName}Descriptor = useMemo(() => {
    if (state.status === 'loading') {
      return { text: 'Loading...', className: '${name}__badge ${name}__badge--pending' };
    }
    if (state.status === 'active') {
      return { text: 'Active', className: '${name}__badge ${name}__badge--active' };
    }
    return { text: 'Ready', className: '${name}__badge ${name}__badge--ready' };
  }, [state.status]);

  const handleAction = () => {
    if (!canProceed) return;
    setState({ status: 'active', activeId: 'item-1' });
    options.onAction?.();
  };

  return { state, canProceed, descriptor, handleAction };
};
`;

export const buildPropsType = (name, pascalName) => `export interface ${pascalName}Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly variant?: 'standard' | 'highlight';
  readonly onAction?: () => void;
}

export interface ${pascalName}Emits {
  (e: 'action', title: string): void;
}
`;

export const buildStateType = (name, pascalName) => `export type ${pascalName}State =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly progress: number }
  | { readonly status: 'active'; readonly activeId: string }
  | { readonly status: 'fault'; readonly faultMessage: string };

export interface ${pascalName}Descriptor {
  readonly text: string;
  readonly className: string;
}
`;

export const buildTypesIndex = (fileNames = ['props', 'state']) =>
  fileNames.map((f) => `export type * from './${f}.d.ts';`).join('\n') + '\n';

export const buildTypes = (name, pascalName) => `${buildStateType(name, pascalName)}
${buildPropsType(name, pascalName)}`;

export const buildComponentSpec = (name, pascalName, hasController = true) => {
  if (hasController) {
    return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { use${pascalName}Controller } from './${name}.controller.ts';

describe('${pascalName} Capsule Controller', () => {
  it('exports pure controller hook', () => {
    assert.equal(typeof use${pascalName}Controller, 'function');
  });
});
`;
  }

  return `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('${pascalName} Atom Foundation', () => {
  it('defines foundational UI atom contract', () => {
    assert.ok(true);
  });
});
`;
};

export const buildScss = (name) => `.${name} {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: rgba(19, 30, 58, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(98, 201, 255, 0.15);
  border-radius: 8px;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__title {
    margin: 0;
    font-size: 16px;
    color: #ffffff;
  }

  &__subtitle {
    margin: 4px 0 0;
    font-size: 12px;
    color: #94a3b8;
  }

  &__badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #0b1329;

    &--ready { color: #62c9ff; }
    &--active { color: #4ade80; }
    &--pending { color: #facc15; }
  }

  &__body {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
  }

  &__action {
    padding: 6px 14px;
    border-radius: 4px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #ffffff;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #334155;
      border-color: #62c9ff;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}
`;

export const buildIndex = (name, pascalName, ext) => {
  const compExport = ext === 'vue' || ext === 'svelte'
    ? `export { default as ${pascalName} } from './${name}.${ext}';`
    : `export { ${pascalName} } from './${name}';`;

  return `${compExport}
export { use${pascalName}Controller } from './${name}.controller';
export type * from './types';
`;
};

export const buildHook = (name, camelName, pascalName) => `import { useState, useCallback, useEffect } from 'react';
import type { ${pascalName}HookOptions, ${pascalName}HookReturn } from './types';

export const ${camelName} = (options: ${pascalName}HookOptions = {}): ${pascalName}HookReturn => {
  const [data, setData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData('ready');
      options.onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  useEffect(() => {
    if (options.immediate) {
      execute();
    }
  }, [options.immediate, execute]);

  return { data, isLoading, error, execute };
};
`;

export const buildHookOptionsType = (pascalName) => `export interface ${pascalName}HookOptions {
  readonly immediate?: boolean;
  readonly onSuccess?: () => void;
}
`;

export const buildHookReturnType = (pascalName) => `export interface ${pascalName}HookReturn {
  readonly data: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly execute: () => Promise<void>;
}
`;

export const buildHookIndex = (name, camelName) => `export { ${camelName} } from './${name}';
export type * from './types';
`;

export const buildHookSpec = (name, camelName) => `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ${camelName} } from './${name}.ts';

describe('${camelName} Hook Composable', () => {
  it('exports pure hook function', () => {
    assert.equal(typeof ${camelName}, 'function');
  });
});
`;

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

export const buildViewSpec = (name, pascalName) => `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('${pascalName}View Table of Contents', () => {
  it('defines pure declarative blueprint layout', () => {
    assert.ok(true);
  });
});
`;
