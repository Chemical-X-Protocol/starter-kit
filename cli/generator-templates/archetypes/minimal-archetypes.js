/**
 * Minimal & Prototyping Archetypes: Minimal Blank Slate, Controls Dock, Canvas Context
 */

export const MINIMAL_ARCHETYPE = {
  id: 'minimal',
  name: 'Minimal Blank Slate',
  keywords: ['minimal', 'bare', 'blank', 'clean', 'simple', 'empty'],
  destructure: 'isActive, toggleActive',
  buildState: (name, pascal) => `export interface ${pascal}State {
  readonly isActive: boolean;
}
`,
  buildProps: (name, pascal) => `import type { ReactNode } from 'react';

export interface ${pascal}Props {
  readonly className?: string;
  readonly children?: ReactNode;
  readonly defaultActive?: boolean;
}
`,
  buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { defaultActive?: boolean } = {}) => {
  const [isActive, setIsActive] = useState<boolean>(Boolean(options.defaultActive));

  const toggleActive = () => {
    setIsActive((prev) => !prev);
  };

  return { isActive, toggleActive };
};
`,
  buildReactBody: (name) => `      <div className="${name}__content">
        {children}
      </div>`
};

export const CONTROLS_ARCHETYPE = {
  id: 'controls',
  name: 'Interactive Controls Dock',
  keywords: ['controls', 'dock', 'toolbar', 'actions', 'slider', 'toggle', 'buttons'],
  destructure: 'isEnabled, value, setEnabled, setValue, reset',
  buildState: (name, pascal) => `export interface ${pascal}State {
  readonly isEnabled: boolean;
  readonly value: number;
}
`,
  buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialValue?: number;
  readonly defaultEnabled?: boolean;
  readonly onValueChange?: (value: number) => void;
  readonly className?: string;
}
`,
  buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { initialValue?: number; defaultEnabled?: boolean; onValueChange?: (value: number) => void } = {}) => {
  const [isEnabled, setEnabled] = useState<boolean>(options.defaultEnabled ?? true);
  const [value, setValueState] = useState<number>(options.initialValue ?? 0);

  const setValue = (next: number) => {
    setValueState(next);
    options.onValueChange?.(next);
  };

  const reset = () => {
    setValue(options.initialValue ?? 0);
    setEnabled(options.defaultEnabled ?? true);
  };

  return { isEnabled, value, setEnabled, setValue, reset };
};
`,
  buildReactBody: (name) => `      <div className="${name}__controls">
        <button type="button" onClick={() => setEnabled(!isEnabled)}>
          {isEnabled ? 'Enabled' : 'Disabled'}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
        <button type="button" onClick={reset}>Reset</button>
      </div>`
};

export const CANVAS_ARCHETYPE = {
  id: 'canvas',
  name: 'Canvas & Viewport Context',
  keywords: ['canvas', 'webgl', 'three', 'render', 'stage', 'viewport', 'scene', 'graphics'],
  destructure: 'canvasRef, isReady',
  buildState: (name, pascal) => `export interface ${pascal}State {
  readonly isReady: boolean;
}
`,
  buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}
`,
  buildController: (name, pascal) => `import { useState, useRef, useEffect } from 'react';

export const use${pascal}Controller = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) setIsReady(true);
  }, []);

  return { canvasRef, isReady };
};
`,
  buildReactBody: (name) => `      <canvas
        ref={canvasRef}
        className="${name}__canvas"
      />`
};

export const MINIMAL_ARCHETYPES = [
  MINIMAL_ARCHETYPE,
  CONTROLS_ARCHETYPE,
  CANVAS_ARCHETYPE
];
