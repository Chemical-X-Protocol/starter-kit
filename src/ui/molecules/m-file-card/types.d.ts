export interface CodebaseFileRecord {
  readonly path: string;
  readonly lines: number;
  readonly tier?: string;
  readonly healthScore?: number;
  readonly hazardCount?: number;
  readonly lastModified?: number;
}

export interface FileCardProps {
  readonly file: CodebaseFileRecord;
}

export interface FileCardEmits {
  (e: 'select', filePath: string): void;
}
