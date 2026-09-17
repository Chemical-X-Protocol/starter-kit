import type { CodebaseFileRecord } from '../../molecules/m-file-card/types';

export interface CodebaseCatalogProps {
  readonly files: CodebaseFileRecord[];
}

export interface CodebaseCatalogEmits {
  (e: 'select-file', filePath: string): void;
}
