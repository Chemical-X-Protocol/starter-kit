import { resolveArchetype } from './archetypes/index.js';
import { convertReactControllerToVue, convertReactControllerToSvelte } from './controller-converters.js';

export const buildController = (name, pascalName, options = {}) => {
  const fw = options.framework ? options.framework.toLowerCase() : 'react';
  const archetype = resolveArchetype(name, options.description || options.desc, options.template || options.archetype);

  if (archetype && typeof archetype.buildController === 'function') {
    const rawReactController = archetype.buildController(name, pascalName);
    if (fw === 'vue') {
      return convertReactControllerToVue(rawReactController);
    }
    if (fw === 'svelte') {
      return convertReactControllerToSvelte(rawReactController, name, pascalName);
    }
    return rawReactController;
  }

  if (fw === 'vue') {
    return `import { ref, computed } from 'vue';
import type { ${pascalName}State, ${pascalName}Descriptor } from './types';

interface ControllerOptions {
  readonly initialState?: ${pascalName}State;
  readonly onAction?: () => void;
}

export const use${pascalName}Controller = (options: ControllerOptions = {}) => {
  const state = ref<${pascalName}State>(
    options.initialState || { status: 'idle' }
  );

  const isIdle = computed(() => state.value.status === 'idle');
  const isPending = computed(() => state.value.status === 'loading');
  const canProceed = computed(() => isIdle.value && !isPending.value);

  const descriptor = computed<${pascalName}Descriptor>(() => {
    if (state.value.status === 'loading') {
      return { text: 'Loading...', className: '${name}__badge ${name}__badge--pending' };
    }
    if (state.value.status === 'active') {
      return { text: 'Active', className: '${name}__badge ${name}__badge--active' };
    }
    return { text: 'Ready', className: '${name}__badge ${name}__badge--ready' };
  });

  const handleAction = () => {
    if (!canProceed.value) return;
    state.value = { status: 'active', activeId: 'item-1' };
    options.onAction?.();
  };

  return { state, canProceed, descriptor, handleAction };
};
`;
  }

  if (fw === 'svelte') {
    return `import type { ${pascalName}State, ${pascalName}Descriptor } from './types';

interface ControllerOptions {
  readonly initialState?: ${pascalName}State;
  readonly onAction?: () => void;
}

export const create${pascalName}Controller = (options: ControllerOptions = {}) => {
  let state = $state<${pascalName}State>(
    options.initialState || { status: 'idle' }
  );

  const isIdle = $derived(state.status === 'idle');
  const isPending = $derived(state.status === 'loading');
  const canProceed = $derived(isIdle && !isPending);

  const descriptor = $derived<${pascalName}Descriptor>(
    state.status === 'loading'
      ? { text: 'Loading...', className: '${name}__badge ${name}__badge--pending' }
      : state.status === 'active'
        ? { text: 'Active', className: '${name}__badge ${name}__badge--active' }
        : { text: 'Ready', className: '${name}__badge ${name}__badge--ready' }
  );

  const handleAction = () => {
    if (!canProceed) return;
    state = { status: 'active', activeId: 'item-1' };
    options.onAction?.();
  };

  return {
    get state() { return state; },
    get canProceed() { return canProceed; },
    get descriptor() { return descriptor; },
    handleAction
  };
};

export const use${pascalName}Controller = create${pascalName}Controller;
`;
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
