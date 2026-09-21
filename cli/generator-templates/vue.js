import { resolveArchetype } from './archetypes/index.js';

export const buildVueComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const hasController = options.hasController !== false;
  const archetype = resolveArchetype(name, options.description || options.desc, options.template || options.archetype);

  const controllerImport = hasController
    ? `import { use${pascalName}Controller } from './${name}.controller';\n`
    : '';

  if (archetype && archetype.id !== 'state-boundary' && hasController && typeof archetype.buildReactBody === 'function') {
    const destructureProps = archetype.destructure || 'state, canProceed, descriptor, handleAction';

    let bodyContent = '';
    if (archetype.id === 'task-list') {
      const btnTag = atomsPackage ? 'a-button' : 'button';
      bodyContent = `    <form
      class="${name}__form"
      @submit.prevent="(e) => {
        const target = e.currentTarget as HTMLFormElement;
        const input = target.elements.namedItem('taskTitle') as HTMLInputElement;
        if (input && input.value.trim()) {
          addItem(input.value.trim());
          input.value = '';
        }
      }"
    >
      <input
        name="taskTitle"
        type="text"
        placeholder="Add a new task..."
        class="${name}__input"
      />
      <${btnTag} type="submit" class="${name}__add-btn">Add</${btnTag}>
    </form>
    <div class="${name}__controls">
      <span class="${name}__counter">{{ activeCount }} active</span>
      <div class="${name}__filters">
        <${btnTag}
          v-for="f in (['all', 'active', 'completed'] as const)"
          :key="f"
          type="button"
          :class="{ active: filter === f }"
          @click="setFilter(f)"
        >
          {{ f }}
        </${btnTag}>
      </div>
    </div>
    <ul class="${name}__list">
      <li v-for="item in items" :key="item.id" :class="{ completed: item.completed }">
        <input type="checkbox" :checked="item.completed" @change="toggleItem(item.id)" />
        <span>{{ item.title }}</span>
        <${btnTag} type="button" @click="removeItem(item.id)">×</${btnTag}>
      </li>
    </ul>`;
    } else {
      let converted = archetype.buildReactBody(name, pascalName);
      if (atomsPackage) {
        converted = converted
          .replace(/<button\b/g, '<a-button')
          .replace(/<\/button>/g, '</a-button>');
      }
      converted = converted
        .replace(/\bclassName=/g, 'class=')
        .replace(/\bonClick=\{([^}]+)\}/g, '@click="$1"')
        .replace(/\{([a-zA-Z0-9_]+)\}/g, '{{ $1 }}');
      bodyContent = converted;
    }

    return `<script setup lang="ts">
import type { ${pascalName}Props, ${pascalName}Emits } from './types';
${controllerImport}
const props = withDefaults(defineProps<${pascalName}Props>(), {});

const emit = defineEmits<${pascalName}Emits>();

const { ${destructureProps} } = use${pascalName}Controller(props);
</script>

<template>
  <div class="${name}">
${bodyContent}
  </div>
</template>

<style lang="scss" scoped>
@use './_${name}.scss';
</style>
`;
  }

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
