import { useEffect, useRef } from 'react';

export const useSelfCleaningInterval = (callback: () => void, delayMs: number | null): void => {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const isDisabled = delayMs === null;
    if (isDisabled) return;
    const intervalId = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(intervalId);
  }, [delayMs]);
};

export const useSelfCleaningTimeout = (callback: () => void, delayMs: number | null): void => {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const isDisabled = delayMs === null;
    if (isDisabled) return;
    const timerId = setTimeout(() => savedCallback.current(), delayMs);
    return () => clearTimeout(timerId);
  }, [delayMs]);
};
