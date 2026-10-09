export declare function printHelp(topicArgs?: string[]): Promise<boolean>;
export declare function printCommandHelp(token: string): Promise<boolean>;
export declare function printInitHelp(): Promise<boolean>;
export declare function printScaffoldHelp(): Promise<boolean>;
export declare function printSearchHelp(): Promise<boolean>;
export declare function formatTopLevelHelp(): string;
export declare function resolveCommandHelpTopic(command: string, rawArgs: string[]): string | null;
