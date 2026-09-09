export type Result<T, E = Error> = [T, null] | [null, E];

export const toResult = async <T, E = Error>(
  promiseOrFn: Promise<T> | (() => Promise<T> | T)
): Promise<Result<T, E>> => {
  try {
    const value = typeof promiseOrFn === 'function' ? await promiseOrFn() : await promiseOrFn;
    return [value, null];
  } catch (err: unknown) {
    const normalizedError = (err instanceof Error ? err : new Error(String(err))) as E;
    return [null, normalizedError];
  }
};
