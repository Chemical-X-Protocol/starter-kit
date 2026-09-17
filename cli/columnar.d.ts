export interface ColumnarData<T = any> {
  readonly cols: readonly string[];
  readonly rows: readonly T[][];
}

export declare function toColumnar<T extends Record<string, any>>(
  items?: readonly T[],
  cols?: readonly string[],
  accessors?: Record<string, (item: T) => any>
): ColumnarData;

export declare function fromColumnar<T extends Record<string, any>>(
  columnar?: ColumnarData
): readonly T[];
