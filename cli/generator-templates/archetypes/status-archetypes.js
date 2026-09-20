/**
 * Status, Feedback & Search Archetypes: Search Filter, KPI Metric, Toast, Media Player, Timer
 */

export const STATUS_ARCHETYPES = [
  {
    id: 'search-filter',
    name: 'Input & Search Filter',
    keywords: ['search', 'filter', 'query', 'find', 'lookup', 'keyword'],
    destructure: 'query, isSearching, activeFilters, handleQueryChange, toggleFilter, clear, placeholder',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly query: string;
  readonly isSearching: boolean;
  readonly activeFilters: readonly string[];
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly placeholder?: string;
  readonly onSearch?: (query: string) => void;
  readonly onFilterChange?: (filters: readonly string[]) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { onSearch?: (q: string) => void; onFilterChange?: (f: readonly string[]) => void } = {}) => {
  const [query, setQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<readonly string[]>([]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    options.onSearch?.(val);
  };

  const toggleFilter = (tag: string) => {
    const next = activeFilters.includes(tag)
      ? activeFilters.filter((t) => t !== tag)
      : [...activeFilters, tag];
    setActiveFilters(next);
    options.onFilterChange?.(next);
  };

  const clear = () => {
    setQuery('');
    setActiveFilters([]);
    options.onSearch?.('');
  };

  return { query, isSearching, activeFilters, handleQueryChange, toggleFilter, clear, setIsSearching };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__search-bar">
        <input type="text" value={query} placeholder={placeholder || 'Search...'} onChange={(e) => handleQueryChange(e.target.value)} />
        {query && <button type="button" onClick={clear}>Clear</button>}
      </div>`
  },
  {
    id: 'kpi-metric',
    name: 'Card & KPI Metric',
    keywords: ['kpi', 'metric', 'stat', 'counter', 'tile'],
    destructure: 'label, value, delta, trend, refresh',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly value: number | string;
  readonly delta: number;
  readonly trend: 'up' | 'down' | 'neutral';
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly label?: string;
  readonly value?: number | string;
  readonly delta?: number;
  readonly onRefresh?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { value?: number | string; delta?: number; onRefresh?: () => void } = {}) => {
  const [value, setValue] = useState<number | string>(options.value ?? 1284);
  const [delta, setDelta] = useState<number>(options.delta ?? 12.5);

  const trend: 'up' | 'down' | 'neutral' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';

  const refresh = () => {
    options.onRefresh?.();
  };

  return { value, delta, trend, setValue, setDelta, refresh };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__card">
        <span className="${name}__label">{label || 'Total Metric'}</span>
        <h2 className="${name}__value">{value}</h2>
        <span className={\`${name}__trend ${name}__trend--\${trend}\`}>{delta > 0 ? '+' : ''}{delta}%</span>
      </div>`
  },
  {
    id: 'notification-toast',
    name: 'Notification & Toast',
    keywords: ['toast', 'alert', 'banner', 'notice', 'snackbar'],
    destructure: 'notifications, notify, dismiss',
    buildState: (name, pascal) => `export interface ${pascal}Notification {
  readonly id: string;
  readonly type: 'info' | 'success' | 'warning' | 'error';
  readonly message: string;
}

export interface ${pascal}State {
  readonly notifications: readonly ${pascal}Notification[];
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly autoDismissMs?: number;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}Notification } from './types';

export const use${pascal}Controller = (options: { autoDismissMs?: number } = {}) => {
  const [notifications, setNotifications] = useState<readonly ${pascal}Notification[]>([]);

  const notify = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = String(Date.now());
    setNotifications((prev) => [...prev, { id, type, message }]);
    if (options.autoDismissMs) {
      setTimeout(() => dismiss(id), options.autoDismissMs);
    }
  };

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return { notifications, notify, dismiss };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__tray">
        {notifications.map((n) => (
          <div key={n.id} className={\`${name}__toast ${name}__toast--\${n.type}\`}>
            <span>{n.message}</span>
            <button type="button" onClick={() => dismiss(n.id)}>×</button>
          </div>
        ))}
      </div>`
  },
  {
    id: 'media-player',
    name: 'Media Player & Carousel',
    keywords: ['player', 'carousel', 'gallery', 'slider', 'audio', 'video'],
    destructure: 'currentIndex, isPlaying, total, next, prev, togglePlay',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly currentIndex: number;
  readonly isPlaying: boolean;
  readonly totalItems: number;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly itemCount?: number;
  readonly onIndexChange?: (idx: number) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { itemCount?: number; onIndexChange?: (idx: number) => void } = {}) => {
  const total = options.itemCount || 3;
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const next = () => {
    setCurrentIndex((prev) => {
      const nextIdx = (prev + 1) % total;
      options.onIndexChange?.(nextIdx);
      return nextIdx;
    });
  };

  const prev = () => {
    setCurrentIndex((prev) => {
      const prevIdx = (prev - 1 + total) % total;
      options.onIndexChange?.(prevIdx);
      return prevIdx;
    });
  };

  const togglePlay = () => setIsPlaying((p) => !p);

  return { currentIndex, isPlaying, total, next, prev, togglePlay };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__viewer">
        <span>Slide {currentIndex + 1} of {total}</span>
        <div className="${name}__controls">
          <button type="button" onClick={prev}>Prev</button>
          <button type="button" onClick={togglePlay}>{isPlaying ? 'Pause' : 'Play'}</button>
          <button type="button" onClick={next}>Next</button>
        </div>
      </div>`
  },
  {
    id: 'timer-countdown',
    name: 'Timer & Countdown',
    keywords: ['timer', 'stopwatch', 'countdown', 'clock', 'schedule'],
    destructure: 'remainingSeconds, isRunning, isComplete, start, pause, reset',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly remainingSeconds: number;
  readonly isRunning: boolean;
  readonly isComplete: boolean;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly durationSeconds?: number;
  readonly onComplete?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { durationSeconds?: number; onComplete?: () => void } = {}) => {
  const initial = options.durationSeconds ?? 60;
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initial);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const start = () => setIsRunning(true);
  const pause = () => setIsRunning(false);
  const reset = () => {
    setIsRunning(false);
    setRemainingSeconds(initial);
  };

  const isComplete = remainingSeconds <= 0;

  return { remainingSeconds, isRunning, isComplete, start, pause, reset };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__timer">
        <h2>{remainingSeconds}s</h2>
        <div className="${name}__actions">
          <button type="button" onClick={isRunning ? pause : start}>{isRunning ? 'Pause' : 'Start'}</button>
          <button type="button" onClick={reset}>Reset</button>
        </div>
      </div>`
  }
];
