import { resolveArchetype } from './archetypes/index.js';

export const buildController = (name, pascalName) => {
  const archetype = resolveArchetype(name);
  if (archetype && typeof archetype.buildController === 'function') {
    return archetype.buildController(name, pascalName);
  }

  return `import { useState, useMemo } from 'react';
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
};
