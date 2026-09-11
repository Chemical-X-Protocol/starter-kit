export declare const REPORT_CARD_ASCII: readonly string[];
export declare function getReportCardAsciiLines(color?: string): readonly string[];
export declare function getAsciiGradeLines(grade?: string, color?: string, withEquals?: boolean): readonly string[];
export declare function formatAsciiGrade(grade?: string, color?: string, indent?: string, withEquals?: boolean): string;
