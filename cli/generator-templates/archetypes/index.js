/**
 * Chemical X Protocol: 22 Canonical Semantic Archetypes Registry
 */

import { COLLECTION_ARCHETYPES } from './collection-archetypes.js';
import { INPUT_ARCHETYPES } from './input-archetypes.js';
import { LAYOUT_ARCHETYPES } from './layout-archetypes.js';
import { DOMAIN_ARCHETYPES } from './domain-archetypes.js';
import { STATUS_ARCHETYPES } from './status-archetypes.js';

export const ALL_ARCHETYPES = [
  ...COLLECTION_ARCHETYPES,
  ...INPUT_ARCHETYPES,
  ...LAYOUT_ARCHETYPES,
  ...DOMAIN_ARCHETYPES,
  ...STATUS_ARCHETYPES
];

export const resolveArchetype = (slug = '') => {
  const normalized = String(slug).toLowerCase().replace(/^(m-|a-|o-|t-|v-|use-)/, '');
  const tokens = normalized.split(/[-_]/).filter(Boolean);

  for (const archetype of ALL_ARCHETYPES) {
    if (archetype.id === normalized || archetype.keywords.includes(normalized)) {
      return archetype;
    }
    const hasKeyword = archetype.keywords.some((kw) => tokens.includes(kw) || normalized.includes(kw));
    if (hasKeyword) {
      return archetype;
    }
  }

  // Fallback to State Boundary (Archetype #22 in LAYOUT_ARCHETYPES)
  return LAYOUT_ARCHETYPES.find((a) => a.id === 'state-boundary') || ALL_ARCHETYPES[0];
};
