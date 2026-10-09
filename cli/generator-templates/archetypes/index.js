/**
 * Chemical X Protocol: 22 Canonical Semantic Archetypes Registry
 */

import { COLLECTION_ARCHETYPES } from './collection-archetypes.js';
import { INPUT_ARCHETYPES } from './input-archetypes.js';
import { LAYOUT_ARCHETYPES } from './layout-archetypes.js';
import { DOMAIN_ARCHETYPES } from './domain-archetypes.js';
import { STATUS_ARCHETYPES } from './status-archetypes.js';
import { MINIMAL_ARCHETYPES } from './minimal-archetypes.js';
import { matchArchetypeByVector } from './vector-matcher.js';

export { matchArchetypeByVector };

export const ALL_ARCHETYPES = [
  ...COLLECTION_ARCHETYPES,
  ...INPUT_ARCHETYPES,
  ...LAYOUT_ARCHETYPES,
  ...DOMAIN_ARCHETYPES,
  ...STATUS_ARCHETYPES
];

export const EXTENDED_ARCHETYPES = [
  ...MINIMAL_ARCHETYPES,
  ...ALL_ARCHETYPES
];

const isPartialMatch = (token, kw) => {
  const isMinLength = token.length >= 3;
  const isAffixMatch = token.startsWith(kw) || kw.startsWith(token);
  return isMinLength && isAffixMatch;
};

export const resolveArchetype = (slug = '', description = '', explicitTemplate = '') => {
  if (explicitTemplate) {
    const templateNorm = String(explicitTemplate).toLowerCase().trim();
    const exactMatch = EXTENDED_ARCHETYPES.find((a) => a.id === templateNorm || a.keywords.includes(templateNorm));
    if (exactMatch) return exactMatch;
  }

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
    const isIdMatch = archetype.id === normalized;
    if (isIdMatch) score += 30;
    const isKeywordMatch = archetype.keywords.includes(normalized);
    if (isKeywordMatch) score += 25;

    for (const token of slugTokens) {
      const isSlugIdMatch = archetype.id === token;
      if (isSlugIdMatch) {
        score += 15;
      } else {
        const isSlugIdPartial = archetype.id.includes(token);
        if (isSlugIdPartial) score += 8;
      }

      for (const kw of archetype.keywords) {
        const isSlugKeywordExact = token === kw;
        if (isSlugKeywordExact) {
          score += 12;
        } else {
          const isSlugKeywordPartial = isPartialMatch(token, kw);
          if (isSlugKeywordPartial) score += 8;
        }
      }
    }

    for (const token of descTokens) {
      const isDescIdMatch = archetype.id === token;
      if (isDescIdMatch) {
        score += 10;
      } else {
        const isDescIdPartial = archetype.id.includes(token);
        if (isDescIdPartial) score += 5;
      }

      for (const kw of archetype.keywords) {
        const isDescKeywordExact = token === kw;
        if (isDescKeywordExact) {
          score += 7;
        } else {
          const isDescKeywordPartial = isPartialMatch(token, kw);
          if (isDescKeywordPartial) score += 4;
        }
      }
    }

    const isNewBest = score > highestScore;
    if (isNewBest) {
      highestScore = score;
      bestArchetype = archetype;
    }
  }

  const hasKeywordWinner = Boolean(bestArchetype && highestScore > 0);
  if (hasKeywordWinner) {
    return bestArchetype;
  }

  const hasDescription = Boolean(description && String(description).trim());
  if (hasDescription) {
    const vectorMatch = matchArchetypeByVector(description, 0.3);
    if (vectorMatch) {
      return vectorMatch.archetype;
    }
  }

  // Fallback to State Boundary (Archetype #22 in LAYOUT_ARCHETYPES)
  return LAYOUT_ARCHETYPES.find((a) => a.id === 'state-boundary') || ALL_ARCHETYPES[0];
};
