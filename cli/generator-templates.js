export const toPascalCase = (str) =>
  str
    .replace(/^([a-z])-/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

export const buildReactComponent = (name, pascalName) => `import React from 'react';
import type { ${pascalName}Props } from './types';
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
        <button
          type="button"
          className="${name}__action"
          disabled={!canProceed}
          onClick={handleAction}
        >
          {variant}
        </button>
      </div>
    </div>
  );
};

export default ${pascalName};
`;

export const buildVueComponent = (name, pascalName) => `<script setup lang="ts">
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
      <button
        type="button"
        class="${name}__action"
        :disabled="!canProceed"
        @click="handleAction"
      >
        {{ variant }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use './_${name}.scss';
</style>
`;

export const buildSvelteComponent = (name, pascalName) => `<script lang="ts">
import type { ${pascalName}Props } from './types';
import { create${pascalName}Controller } from './${name}.controller';

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
    <button
      type="button"
      class="${name}__action"
      disabled={!controller.canProceed}
      onclick={controller.handleAction}
    >
      {variant}
    </button>
  </div>
</div>

<style lang="scss">
@use './_${name}.scss';
</style>
`;

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

export const buildTypes = (name, pascalName) => `export type ${pascalName}State =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly progress: number }
  | { readonly status: 'active'; readonly activeId: string }
  | { readonly status: 'fault'; readonly faultMessage: string };

export interface ${pascalName}Descriptor {
  readonly text: string;
  readonly className: string;
}

export interface ${pascalName}Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly variant?: 'standard' | 'highlight';
  readonly onAction?: () => void;
}

export interface ${pascalName}Emits {
  (e: 'action', title: string): void;
}
`;

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
export type { ${pascalName}Props, ${pascalName}State } from './types';
`;
};
