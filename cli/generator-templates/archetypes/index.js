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

export const resolveArchetype = (slug = '', description = '') => {
  const normalized = String(slug).toLowerCase().replace(/^(m-|a-|o-|t-|v-|use-)/, '');
  const slugTokens = normalized.split(/[-_]/).filter(Boolean);
  const descTokens = String(description)
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/[\s-_]+/)
    .filter(Boolean);

  let bestArchetype = null;
  let highestScore = 0;

  for (const archetype of ALL_ARCHETYPES) {
    let score = 0;
    if (archetype.id === normalized) score += 30;
    if (archetype.keywords.includes(normalized)) score += 25;

    for (const token of slugTokens) {
      if (archetype.id === token) score += 15;
      else if (archetype.id.includes(token)) score += 8;

      for (const kw of archetype.keywords) {
        if (token === kw) {
          score += 12;
        } else if (token.length >= 3 && (token.startsWith(kw) || kw.startsWith(token))) {
          score += 8;
        }
      }
    }

    for (const token of descTokens) {
      if (archetype.id === token) score += 10;
      else if (archetype.id.includes(token)) score += 5;

      for (const kw of archetype.keywords) {
        if (token === kw) {
          score += 7;
        } else if (token.length >= 3 && (token.startsWith(kw) || kw.startsWith(token))) {
          score += 4;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestArchetype = archetype;
    }
  }

  if (bestArchetype && highestScore > 0) {
    return bestArchetype;
  }

  // Fallback to State Boundary (Archetype #22 in LAYOUT_ARCHETYPES)
  return LAYOUT_ARCHETYPES.find((a) => a.id === 'state-boundary') || ALL_ARCHETYPES[0];
};
