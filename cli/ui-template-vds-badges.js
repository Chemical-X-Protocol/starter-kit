/**
 * Chemical X Protocol: VDS UI Badges and Helpers
 * Formatting helpers for MoSCoW buckets, Single-Slot indicators, and Task Permalinks
 */

export const MOSCOW_COLORS = {
  must: '#ef4444',
  should: '#3b82f6',
  could: '#10b981',
  wont: '#64748b'
};

export const formatMoscowColor = (moscow = 'must') => MOSCOW_COLORS[moscow.toLowerCase()] || MOSCOW_COLORS.must;

export const formatVdsSlotLabel = (t = {}) => {
  const m = (t.moscow || 'must').toUpperCase();
  const p = (t.vds_priority || 'critical').toUpperCase();
  return `[${m} : ${p}]`;
};

export const VDS_MOSCOW_OPTIONS = [
  { value: 'must', label: '🧬 Must Have (Contract)' },
  { value: 'should', label: '✨ Should Have (Buffer)' },
  { value: 'could', label: '🎀 Could Have (Bonus)' },
  { value: 'wont', label: '🦄 Won\'t Have (Out of Scope)' }
];

export const VDS_PRIORITY_OPTIONS = [
  { value: 'critical', label: '🚑 Critical (Slot 1)' },
  { value: 'expedite', label: '🚒 Expedite (Slot 2)' },
  { value: 'high', label: '🚓 High (Slot 3)' },
  { value: 'medium', label: '🚕 Medium (Slot 4)' },
  { value: 'low', label: '🛵 Low (Slot 5)' }
];
