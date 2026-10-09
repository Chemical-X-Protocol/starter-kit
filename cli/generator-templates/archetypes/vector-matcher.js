import { generateEmbedding, cosineSimilarity } from '../../embeddings/vectorizer.js';
import { ALL_ARCHETYPES } from './index.js';

let cachedVectors = null;

const buildArchetypeText = (a) => {
  const idWords = a.id.replace(/[-_]/g, ' ');
  const kwWords = a.keywords.map((k) => k.replace(/[-_]/g, ' ')).join(' ');
  const nameWords = (a.name || '').toLowerCase();
  return `${a.id} ${idWords} ${nameWords} ${kwWords}`;
};

const getArchetypeVectors = () => {
  if (cachedVectors) return cachedVectors;
  cachedVectors = ALL_ARCHETYPES.map((a) => ({
    archetype: a,
    vector: generateEmbedding(buildArchetypeText(a))
  }));
  return cachedVectors;
};

export const matchArchetypeByVector = (descriptionText, minSimilarity = 0.25) => {
  const isMissingDescription = !descriptionText || typeof descriptionText !== 'string';
  if (isMissingDescription) return null;
  const cleanDesc = descriptionText.trim();
  const isBlankDescription = cleanDesc.length === 0;
  if (isBlankDescription) return null;

  const descVector = generateEmbedding(cleanDesc);
  const archetypeVectors = getArchetypeVectors();

  let bestMatch = null;
  let highestSim = 0;

  for (const item of archetypeVectors) {
    const sim = cosineSimilarity(descVector, item.vector);
    const isBetterMatch = sim > highestSim;
    if (isBetterMatch) {
      highestSim = sim;
      bestMatch = item.archetype;
    }
  }

  const isSimilaritySufficient = highestSim >= minSimilarity;
  const isMatchAccepted = Boolean(isSimilaritySufficient && bestMatch);
  if (isMatchAccepted) {
    return {
      archetype: bestMatch,
      similarity: Number(highestSim.toFixed(4))
    };
  }

  return null;
};
