/**
 * Layout & Structural Archetypes: Modal, Tabs, Inspector, State Boundary
 */

export const LAYOUT_ARCHETYPES = [
  {
    id: 'modal-dialog',
    name: 'Modal & Dialog',
    keywords: ['modal', 'dialog', 'sheet', 'drawer', 'popup', 'lightbox'],
    destructure: 'isOpen, payload, open, close, confirm',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly isOpen: boolean;
  readonly payload?: unknown;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly defaultOpen?: boolean;
  readonly onClose?: () => void;
  readonly onConfirm?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { defaultOpen?: boolean; onClose?: () => void; onConfirm?: () => void } = {}) => {
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(options.defaultOpen));
  const [payload, setPayload] = useState<unknown>(null);

  const open = (data?: unknown) => {
    setPayload(data || null);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setPayload(null);
    options.onClose?.();
  };

  const confirm = () => {
    options.onConfirm?.();
    close();
  };

  return { isOpen, payload, open, close, confirm };
};
`,
    buildReactBody: (name, pascal) => `      {isOpen && (
        <div className="${name}__overlay" onClick={close}>
          <div className="${name}__content" onClick={(e) => e.stopPropagation()}>
            <div className="${name}__header">
              <h3>Modal</h3>
              <button type="button" onClick={close}>×</button>
            </div>
            <div className="${name}__actions">
              <button type="button" onClick={close}>Cancel</button>
              <button type="button" onClick={confirm}>Confirm</button>
            </div>
          </div>
        </div>
      )}`
  },
  {
    id: 'navigation-tabs',
    name: 'Navigation & Tabs',
    keywords: ['nav', 'tabs', 'menu', 'breadcrumbs', 'pagination'],
    destructure: 'tabs = [], activeTabId, selectTab',
    buildState: (name, pascal) => `export interface ${pascal}Tab {
  readonly id: string;
  readonly label: string;
}

export interface ${pascal}State {
  readonly activeTabId: string;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly tabs?: readonly { id: string; label: string }[];
  readonly activeTabId?: string;
  readonly onTabChange?: (tabId: string) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { defaultTabId?: string; onTabChange?: (id: string) => void } = {}) => {
  const [activeTabId, setActiveTabId] = useState<string>(options.defaultTabId || 'overview');

  const selectTab = (id: string) => {
    setActiveTabId(id);
    options.onTabChange?.(id);
  };

  return { activeTabId, selectTab };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__tabs" role="tablist">
        {(tabs || [{ id: 'overview', label: 'Overview' }]).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === t.id}
            className={activeTabId === t.id ? '${name}__tab ${name}__tab--active' : '${name}__tab'}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>`
  },
  {
    id: 'detail-inspector',
    name: 'Detail & Inspector',
    keywords: ['detail', 'inspector', 'sidebar', 'properties', 'pane'],
    destructure: 'selectedEntityId, activeSection, isDirty, save, close',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly selectedEntityId: string | null;
  readonly activeSection: string;
  readonly isDirty: boolean;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly entityId?: string | null;
  readonly onClose?: () => void;
  readonly onSave?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { entityId?: string | null; onClose?: () => void; onSave?: () => void } = {}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(options.entityId || null);
  const [activeSection, setActiveSection] = useState<string>('general');
  const [isDirty, setIsDirty] = useState<boolean>(false);

  const save = () => {
    options.onSave?.();
    setIsDirty(false);
  };

  const close = () => {
    options.onClose?.();
  };

  return { selectedEntityId, activeSection, isDirty, setActiveSection, setIsDirty, save, close };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__inspector">
        <div className="${name}__header">
          <span>Entity: {selectedEntityId || 'None'}</span>
          <button type="button" onClick={close}>×</button>
        </div>
        <div className="${name}__body">
          <button type="button" disabled={!isDirty} onClick={save}>Save Changes</button>
        </div>
      </div>`
  },
  {
    id: 'state-boundary',
    name: 'State Boundary & Fallback',
    keywords: ['empty', 'fallback', 'error-boundary', 'placeholder', 'offline'],
    destructure: 'state, canProceed, descriptor, handleAction',
    buildState: (name, pascal) => `export type ${pascal}State =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly progress: number }
  | { readonly status: 'active'; readonly activeId: string }
  | { readonly status: 'fault'; readonly faultMessage: string };

export interface ${pascal}Descriptor {
  readonly text: string;
  readonly className: string;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly title?: string;
  readonly subtitle?: string;
  readonly onAction?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState, useMemo } from 'react';
import type { ${pascal}State, ${pascal}Descriptor } from './types';

interface ControllerOptions {
  readonly initialState?: ${pascal}State;
  readonly onAction?: () => void;
}

export const use${pascal}Controller = (options: ControllerOptions = {}) => {
  const [state, setState] = useState<${pascal}State>(
    options.initialState || { status: 'idle' }
  );

  const isIdle = state.status === 'idle';
  const isPending = state.status === 'loading';
  const canProceed = isIdle && !isPending;

  const descriptor: ${pascal}Descriptor = useMemo(() => {
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
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__status">
        <span className={descriptor.className}>{descriptor.text}</span>
        <button type="button" disabled={!canProceed} onClick={handleAction}>Action</button>
      </div>`
  }
];
