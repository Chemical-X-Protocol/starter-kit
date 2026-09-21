import { resolveArchetype } from './archetypes/index.js';

export const buildSvelteComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const hasController = options.hasController !== false;
  const archetype = resolveArchetype(name, options.description || options.desc, options.template || options.archetype);
  const atomImport = atomsPackage ? `import { AtomButton } from '${atomsPackage}';\n` : '';

  const controllerImport = hasController
    ? `import { create${pascalName}Controller } from './${name}.controller';\n`
    : '';

  if (archetype && archetype.id !== 'state-boundary' && hasController && typeof archetype.buildReactBody === 'function') {
    const destructureProps = archetype.destructure || 'state, canProceed, descriptor, handleAction';
    let bodyContent = '';
    if (archetype.id === 'task-list') {
      const btnTag = atomsPackage ? 'AtomButton' : 'button';
      bodyContent = `  <form
    class="${name}__form"
    onsubmit={(e) => {
      e.preventDefault();
      const target = e.currentTarget as HTMLFormElement;
      const input = target.elements.namedItem('taskTitle') as HTMLInputElement;
      if (input && input.value.trim()) {
        addItem(input.value.trim());
        input.value = '';
      }
    }}
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
    <span class="${name}__counter">{activeCount} active</span>
    <div class="${name}__filters">
      {#each (['all', 'active', 'completed'] as const) as f}
        <${btnTag}
          type="button"
          class={filter === f ? 'active' : ''}
          onclick={() => setFilter(f)}
        >
          {f}
        </${btnTag}>
      {/each}
    </div>
  </div>
  <ul class="${name}__list">
    {#each items as item (item.id)}
      <li class={item.completed ? 'completed' : ''}>
        <input type="checkbox" checked={item.completed} onchange={() => toggleItem(item.id)} />
        <span>{item.title}</span>
        <${btnTag} type="button" onclick={() => removeItem(item.id)}>×</${btnTag}>
      </li>
    {/each}
  </ul>`;
    } else {
      let converted = archetype.buildReactBody(name, pascalName);
      if (atomsPackage) {
        converted = converted
          .replace(/<button\b/g, '<AtomButton')
          .replace(/<\/button>/g, '</AtomButton>');
      }
      converted = converted
        .replace(/\bclassName=/g, 'class=')
        .replace(/\bonClick=/g, 'onclick=')
        .replace(/\bonChange=/g, 'onchange=')
        .replace(/\bonSubmit=/g, 'onsubmit=');
      bodyContent = converted;
    }

    return `<script lang="ts">
import type { ${pascalName}Props } from './types';
${atomImport}${controllerImport}
const props: ${pascalName}Props = $props();

const { ${destructureProps} } = create${pascalName}Controller(props);
</script>

<div class="${name}">
${bodyContent}
</div>

<style lang="scss">
@use './_${name}.scss';
</style>
`;
  }

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

  const controllerLogic = hasController
    ? `const controller = create${pascalName}Controller({
  initialState: { status: 'idle' },
  onAction
});`
    : `const controller = {
  canProceed: true,
  descriptor: { text: 'Ready', className: '${name}__badge ${name}__badge--ready' },
  handleAction: () => onAction?.()
};`;

  return `<script lang="ts">
import type { ${pascalName}Props } from './types';
${atomImport}${controllerImport}
const {
  title,
  subtitle = '',
  variant = 'standard',
  onAction
}: ${pascalName}Props = $props();

${controllerLogic}
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
