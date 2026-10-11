import { resolveArchetype } from './archetypes/index.js';
import { buildAtomImport, hasAtomSource } from './atom-import.js';

export const buildReactComponent = (name, pascalName, options = {}) => {
  const hasAtoms = hasAtomSource(options);
  const hasController = options.hasController !== false;
  const archetype = resolveArchetype(name, options.description || options.desc, options.template || options.archetype);

  const atomImport = buildAtomImport({ framework: 'react', atomsPackage: options.atomsPackage, atomsPath: options.atomsPath });
  const controllerImport = hasController
    ? `import { use${pascalName}Controller } from './${name}.controller';\n`
    : '';

  const hasReactBuilder = Boolean(archetype && archetype.id !== 'state-boundary' && typeof archetype.buildReactBody === 'function');
  if (hasReactBuilder) {
    let bodyContent = archetype.buildReactBody(name, pascalName);
    if (hasAtoms) {
      bodyContent = bodyContent
        .replace(/<button\b/g, '<AtomButton')
        .replace(/<\/button>/g, '</AtomButton>');
    }

    const stateBindings = hasController
      ? `  const { ${archetype.destructure} } = { ...props, ...use${pascalName}Controller(props) };`
      : `  const { ${archetype.destructure} } = props;`;

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

  const actionButton = hasAtoms
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
