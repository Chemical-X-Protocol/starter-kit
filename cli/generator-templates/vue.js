export const buildVueComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const hasController = options.hasController !== false;
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

  const controllerImport = hasController
    ? `import { use${pascalName}Controller } from './${name}.controller';\n`
    : '';

  const controllerLogic = hasController
    ? `const { state, canProceed, descriptor, handleAction } = use${pascalName}Controller({
  initialState: { status: 'idle' },
  onAction: () => emit('action', props.title)
});`
    : `const canProceed = true;
const descriptor = { text: 'Ready', className: '${name}__badge ${name}__badge--ready' };
const handleAction = () => emit('action', props.title);`;

  return `<script setup lang="ts">
import type { ${pascalName}Props, ${pascalName}Emits } from './types';
${controllerImport}
const props = withDefaults(defineProps<${pascalName}Props>(), {
  variant: 'standard'
});

const emit = defineEmits<${pascalName}Emits>();

${controllerLogic}
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
