import { useMemo } from 'react';

export type PredicateFn<T> = (item: T) => boolean;

export interface UsePredicateFilterReturn<T> {
  readonly filtered: readonly T[];
  readonly count: number;
  readonly hasMatches: boolean;
}

export const createPredicateFilter = <T>(predicate: PredicateFn<T>) => {
  return (items: readonly T[]): T[] => items.filter(predicate);
};

export const matchesAnyPattern = (value: string, patterns: readonly string[]): boolean => {
  return patterns.some((pattern) => value.includes(pattern));
};

export const matchesAllPredicates = <T>(item: T, predicates: readonly PredicateFn<T>[]): boolean => {
  return predicates.every((predicate) => predicate(item));
};

export const usePredicateFilter = <T>(
  items: readonly T[],
  predicate: PredicateFn<T>
): UsePredicateFilterReturn<T> => {
  const filtered = useMemo(() => items.filter(predicate), [items, predicate]);
  const count = filtered.length;
  const hasMatches = count > 0;

  return { filtered, count, hasMatches };
};
