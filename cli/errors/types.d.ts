export interface ErrorReport {
  readonly message: string;
  readonly name: string;
  readonly stack: string;
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly timestamp: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly chemxVersion: string;
  readonly gitBranch?: string;
  readonly gitCommit?: string;
  readonly context?: Record<string, unknown>;
}

export interface IssueContent {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly webUrl: string;
  readonly targetRepo: string;
}

export interface PublishIssueResult {
  readonly success: boolean;
  readonly url: string | null;
  readonly issueNumber: number | null;
  readonly error: string | null;
}

export interface ErrorCatcherOptions {
  readonly repo?: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly labels?: readonly string[];
  readonly autoPost?: boolean;
  readonly silent?: boolean;
  readonly exitOnError?: boolean;
  readonly exitCode?: number;
  readonly context?: Record<string, unknown>;
}
