export const buildSvelteComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const hasController = options.hasController !== false;
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

  const controllerImport = hasController
    ? `import { create${pascalName}Controller } from './${name}.controller';\n`
    : '';

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
