export const buildPropsType = (name, pascalName) => `export interface ${pascalName}Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly variant?: 'standard' | 'highlight';
  readonly onAction?: () => void;
}

export interface ${pascalName}Emits {
  (e: 'action', title: string): void;
}
`;

export const buildStateType = (name, pascalName) => `export type ${pascalName}State =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly progress: number }
  | { readonly status: 'active'; readonly activeId: string }
  | { readonly status: 'fault'; readonly faultMessage: string };

export interface ${pascalName}Descriptor {
  readonly text: string;
  readonly className: string;
}
`;

export const buildTypesIndex = (fileNames = ['props', 'state']) =>
  fileNames.map((f) => `export type * from './${f}.d.ts';`).join('\n') + '\n';

export const buildTypes = (name, pascalName) => `${buildStateType(name, pascalName)}
${buildPropsType(name, pascalName)}`;
