/**
 * Collection & Data Archetypes: Task List, Data Table, Tree, Chart, Kanban
 */

export const COLLECTION_ARCHETYPES = [
  {
    id: 'task-list',
    name: 'Collection & Task List',
    keywords: ['task', 'todo', 'tasklist', 'checklist', 'item', 'queue', 'list', 'add', 'toggle', 'remove', 'delete'],
    destructure: 'items, activeCount, setFilter, toggleItem, removeItem',
    buildState: (name, pascal) => `export interface ${pascal}Item {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
}

export type ${pascal}Filter = 'all' | 'active' | 'completed';

export interface ${pascal}State {
  readonly items: readonly ${pascal}Item[];
  readonly filter: ${pascal}Filter;
  readonly activeCount: number;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialItems?: readonly ${pascal}Item[];
  readonly onItemsChange?: (items: readonly ${pascal}Item[]) => void;
}
`,
    buildController: (name, pascal) => `import { useState, useMemo } from 'react';
import type { ${pascal}Item, ${pascal}Filter, ${pascal}State } from './types';

export const use${pascal}Controller = (options: { initialItems?: readonly ${pascal}Item[]; onItemsChange?: (items: readonly ${pascal}Item[]) => void } = {}) => {
  const [items, setItems] = useState<readonly ${pascal}Item[]>(options.initialItems || [
    { id: '1', title: 'Initialize Chemical X molecular structure', completed: true },
    { id: '2', title: 'Implement domain controller state', completed: false }
  ]);
  const [filter, setFilter] = useState<${pascal}Filter>('all');

  const activeCount = useMemo(() => items.filter((i) => !i.completed).length, [items]);
  const visibleItems = useMemo(() => {
    if (filter === 'active') return items.filter((i) => !i.completed);
    if (filter === 'completed') return items.filter((i) => i.completed);
    return items;
  }, [items, filter]);

  const addItem = (title: string) => {
    if (!title.trim()) return;
    const next = [...items, { id: String(Date.now()), title: title.trim(), completed: false }];
    setItems(next);
    options.onItemsChange?.(next);
  };

  const toggleItem = (id: string) => {
    const next = items.map((i) => (i.id === id ? { ...i, completed: !i.completed } : i));
    setItems(next);
    options.onItemsChange?.(next);
  };

  const removeItem = (id: string) => {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    options.onItemsChange?.(next);
  };

  return { items: visibleItems, allItems: items, filter, activeCount, setFilter, addItem, toggleItem, removeItem };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__controls">
        <span className="${name}__count">{activeCount} pending</span>
        <div className="${name}__filters">
          <button type="button" onClick={() => setFilter('all')}>All</button>
          <button type="button" onClick={() => setFilter('active')}>Active</button>
          <button type="button" onClick={() => setFilter('completed')}>Done</button>
        </div>
      </div>
      <ul className="${name}__list">
        {items.map((item) => (
          <li key={item.id} className={item.completed ? '${name}__item ${name}__item--done' : '${name}__item'}>
            <input type="checkbox" checked={item.completed} onChange={() => toggleItem(item.id)} />
            <span>{item.title}</span>
            <button type="button" onClick={() => removeItem(item.id)}>×</button>
          </li>
        ))}
      </ul>`
  },
  {
    id: 'data-table',
    name: 'Data Table & Grid',
    keywords: ['table', 'grid', 'datatable', 'matrix', 'sheet', 'data-view'],
    destructure: 'rows = [], sortColumn, sortDirection, page, sortBy, setPage',
    buildState: (name, pascal) => `export interface ${pascal}Row {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface ${pascal}State {
  readonly sortColumn: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly page: number;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly rows?: readonly ${pascal}Row[];
  readonly columns?: readonly string[];
  readonly pageSize?: number;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}Row } from './types';

export const use${pascal}Controller = (options: { rows?: readonly ${pascal}Row[]; pageSize?: number } = {}) => {
  const [sortColumn, setSortColumn] = useState<string>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);

  const sortBy = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  return { sortColumn, sortDirection, page, sortBy, setPage };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__header">
        <span className="${name}__sort">Sorted by {sortColumn} ({sortDirection})</span>
      </div>
      <div className="${name}__grid">
        {(rows || []).map((row) => (
          <div key={row.id} className="${name}__row">
            <span>{String(row.id)}</span>
          </div>
        ))}
      </div>`
  },
  {
    id: 'tree-hierarchy',
    name: 'Tree & Hierarchy',
    keywords: ['tree', 'filetree', 'hierarchy', 'node', 'folder', 'explorer'],
    destructure: 'nodes = [], expandedIds, selectedId, toggleNode, selectNode',
    buildState: (name, pascal) => `export interface ${pascal}Node {
  readonly id: string;
  readonly label: string;
  readonly children?: readonly ${pascal}Node[];
}

export interface ${pascal}State {
  readonly expandedIds: readonly string[];
  readonly selectedId: string | null;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly nodes?: readonly ${pascal}Node[];
  readonly onSelect?: (id: string) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}Node } from './types';

export const use${pascal}Controller = (options: { onSelect?: (id: string) => void } = {}) => {
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggleNode = (id: string) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectNode = (id: string) => {
    setSelectedId(id);
    options.onSelect?.(id);
  };

  return { expandedIds, selectedId, toggleNode, selectNode };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__tree">
        {(nodes || []).map((node) => (
          <div key={node.id} className="${name}__node" onClick={() => selectNode(node.id)}>
            <span>{node.label}</span>
          </div>
        ))}
      </div>`
  },
  {
    id: 'chart-analytics',
    name: 'Chart & Sparkline',
    keywords: ['chart', 'graph', 'plot', 'trend', 'sparkline', 'series', 'analytics'],
    destructure: 'series = [], activeIndex, timeRange, setActiveIndex, setTimeRange',
    buildState: (name, pascal) => `export interface ${pascal}DataPoint {
  readonly label: string;
  readonly value: number;
}

export interface ${pascal}State {
  readonly activeIndex: number | null;
  readonly timeRange: '1h' | '24h' | '7d' | '30d';
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly series?: readonly ${pascal}DataPoint[];
  readonly timeRange?: '1h' | '24h' | '7d' | '30d';
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');

  return { activeIndex, timeRange, setActiveIndex, setTimeRange };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__toolbar">
        <span>Range: {timeRange}</span>
      </div>
      <div className="${name}__canvas">
        {(series || []).map((pt, idx) => (
          <div key={idx} className="${name}__bar" style={{ height: \`\${pt.value}%\` }} onMouseEnter={() => setActiveIndex(idx)} />
        ))}
      </div>`
  },
  {
    id: 'kanban-board',
    name: 'Kanban & Workspace Board',
    keywords: ['kanban', 'board', 'column', 'lane', 'pipeline'],
    destructure: 'columns = [], cards = [], activeCardId, setActiveCardId, moveCard',
    buildState: (name, pascal) => `export interface ${pascal}Card {
  readonly id: string;
  readonly title: string;
  readonly columnId: string;
}

export interface ${pascal}Column {
  readonly id: string;
  readonly title: string;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly columns?: readonly ${pascal}Column[];
  readonly cards?: readonly ${pascal}Card[];
  readonly onCardMove?: (cardId: string, toColumnId: string) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}Card } from './types';

export const use${pascal}Controller = (options: { cards?: readonly ${pascal}Card[]; onCardMove?: (id: string, colId: string) => void } = {}) => {
  const [cards, setCards] = useState<readonly ${pascal}Card[]>(options.cards || []);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const moveCard = (cardId: string, toColumnId: string) => {
    const next = cards.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId } : c));
    setCards(next);
    options.onCardMove?.(cardId, toColumnId);
  };

  return { cards, activeCardId, setActiveCardId, moveCard };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__columns">
        {(columns || []).map((col) => (
          <div key={col.id} className="${name}__column">
            <h4>{col.title}</h4>
            {cards.filter((c) => c.columnId === col.id).map((c) => (
              <div key={c.id} className="${name}__card">{c.title}</div>
            ))}
          </div>
        ))}
      </div>`
  }
];
