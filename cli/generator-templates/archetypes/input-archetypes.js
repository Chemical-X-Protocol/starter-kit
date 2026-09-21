/**
 * Input & Capture Archetypes: Form Wizard, Dropdown Select, Toggle Switch, File Upload
 */

export const INPUT_ARCHETYPES = [
  {
    id: 'form-wizard',
    name: 'Form & Wizard',
    keywords: ['form', 'editor', 'wizard', 'stepper', 'signup', 'checkout', 'compose'],
    destructure: 'values, errors, isSubmitting, step, setFieldValue, setStep, submit',
    buildState: (name, pascal) => `export interface ${pascal}Values {
  readonly [key: string]: unknown;
}

export interface ${pascal}State {
  readonly values: ${pascal}Values;
  readonly errors: Record<string, string>;
  readonly isSubmitting: boolean;
  readonly step: number;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialValues?: Record<string, unknown>;
  readonly onSubmit?: (values: Record<string, unknown>) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { initialValues?: Record<string, unknown>; onSubmit?: (values: Record<string, unknown>) => void } = {}) => {
  const [values, setValues] = useState<Record<string, unknown>>(options.initialValues || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [step, setStep] = useState<number>(1);

  const setFieldValue = (field: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const submit = async () => {
    setIsSubmitting(true);
    try {
      options.onSubmit?.(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { values, errors, isSubmitting, step, setFieldValue, setStep, submit };
};
`,
    buildReactBody: (name, pascal) => `      <form className="${name}__form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="${name}__field">
          <label>Input</label>
          <input type="text" onChange={(e) => setFieldValue('input', e.target.value)} />
        </div>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit'}</button>
      </form>`
  },
  {
    id: 'dropdown-select',
    name: 'Dropdown & Select',
    keywords: ['dropdown', 'select', 'combobox', 'picker', 'popover'],
    destructure: 'options = [], isOpen, selectedId, toggle, select',
    buildState: (name, pascal) => `export interface ${pascal}Option {
  readonly id: string;
  readonly label: string;
}

export interface ${pascal}State {
  readonly isOpen: boolean;
  readonly selectedId: string | null;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly options?: readonly { id: string; label: string }[];
  readonly value?: string;
  readonly onSelect?: (id: string) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { options?: readonly { id: string; label: string }[]; onSelect?: (id: string) => void } = {}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggle = () => setIsOpen((prev) => !prev);
  const select = (id: string) => {
    setSelectedId(id);
    setIsOpen(false);
    options.onSelect?.(id);
  };

  return { options: options.options || [], isOpen, selectedId, toggle, select };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__select" onClick={toggle}>
        <span>{selectedId || 'Select option...'}</span>
      </div>
      {isOpen && (
        <ul className="${name}__menu">
          {(options || []).map((opt) => (
            <li key={opt.id} onClick={() => select(opt.id)}>{opt.label}</li>
          ))}
        </ul>
      )}`
  },
  {
    id: 'toggle-switch',
    name: 'Toggle & Controls',
    keywords: ['toggle', 'switch', 'segmented', 'checkbox', 'radio'],
    destructure: 'checked, toggle',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly checked: boolean;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly defaultChecked?: boolean;
  readonly onChange?: (checked: boolean) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { defaultChecked?: boolean; onChange?: (val: boolean) => void } = {}) => {
  const [checked, setChecked] = useState<boolean>(Boolean(options.defaultChecked));

  const toggle = () => {
    setChecked((prev) => {
      const next = !prev;
      options.onChange?.(next);
      return next;
    });
  };

  return { checked, toggle };
};
`,
    buildReactBody: (name, pascal) => `      <button type="button" role="switch" aria-checked={checked} className={checked ? '${name}__switch ${name}__switch--on' : '${name}__switch'} onClick={toggle}>
        <span className="${name}__thumb" />
      </button>`
  },
  {
    id: 'file-upload',
    name: 'Upload & Dropzone',
    keywords: ['upload', 'dropzone', 'file', 'attachment', 'asset', 'uploader'],
    destructure: 'files, isUploading, progress, removeFile',
    buildState: (name, pascal) => `export interface ${pascal}File {
  readonly name: string;
  readonly size: number;
}

export interface ${pascal}State {
  readonly files: readonly ${pascal}File[];
  readonly isUploading: boolean;
  readonly progress: number;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly maxFiles?: number;
  readonly onUpload?: (files: File[]) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}File } from './types';

export const use${pascal}Controller = () => {
  const [files, setFiles] = useState<readonly ${pascal}File[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  return { files, isUploading, progress, removeFile, setFiles, setIsUploading };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__dropzone">
        <span>Drag & drop files here</span>
      </div>
      <ul className="${name}__file-list">
        {files.map((f) => (
          <li key={f.name}>{f.name} ({f.size}B) <button type="button" onClick={() => removeFile(f.name)}>×</button></li>
        ))}
      </ul>`
  }
];
