import { useState, useCallback, useEffect } from 'react';
import { toResult } from './toResult';

export interface UseAsyncDataReturn<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly execute: () => Promise<void>;
}

export const useAsyncData = <T>(
  fetcher: () => Promise<T>,
  immediate: boolean = true
): UseAsyncDataReturn<T> => {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    const [result, fetchError] = await toResult(fetcher());
    if (fetchError) {
      setError(fetchError);
      setIsLoading(false);
      return;
    }

    setData(result);
    setIsLoading(false);
  }, [fetcher]);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return { data, isLoading, error, execute };
};
