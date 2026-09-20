import { resolveArchetype } from './archetypes/index.js';

export const buildReactComponent = (name, pascalName, options = {}) => {
  const atomsPackage = options.atomsPackage || null;
  const hasController = options.hasController !== false;
  const archetype = resolveArchetype(name, options.description || options.desc);

  const atomImport = atomsPackage ? `import { AtomButton } from '${atomsPackage}';\n` : '';
  const controllerImport = hasController
    ? `import { use${pascalName}Controller } from './${name}.controller';\n`
    : '';

  if (archetype && archetype.id !== 'state-boundary' && typeof archetype.buildReactBody === 'function') {
    let bodyContent = archetype.buildReactBody(name, pascalName);
    if (atomsPackage) {
      bodyContent = bodyContent
        .replace(/<button\b/g, '<AtomButton')
        .replace(/<\/button>/g, '</AtomButton>');
    }

    const stateBindings = hasController
      ? `  const { ${archetype.destructure} } = { ...props, ...use${pascalName}Controller(props as any) };`
      : `  const { ${archetype.destructure} } = props as any;`;

    return `import React from 'react';
${atomImport}import type { ${pascalName}Props } from './types';
${controllerImport}
export const ${pascalName}: React.FC<${pascalName}Props> = (props) => {
${stateBindings}

  return (
    <div className="${name}">
${bodyContent}
    </div>
  );
};

export default ${pascalName};
`;
  }

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

  const controllerLogic = hasController
    ? `  const { state, canProceed, descriptor, handleAction } = use${pascalName}Controller({
    initialState: { status: 'idle' },
    onAction
  });`
    : `  const canProceed = true;
  const descriptor = { text: 'Ready', className: '${name}__badge ${name}__badge--ready' };
  const handleAction = () => {
    onAction?.();
  };`;

  return `import React from 'react';
${atomImport}import type { ${pascalName}Props } from './types';
${controllerImport}
export const ${pascalName}: React.FC<${pascalName}Props> = ({
  title,
  subtitle,
  variant = 'standard',
  onAction
}) => {
${controllerLogic}

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
