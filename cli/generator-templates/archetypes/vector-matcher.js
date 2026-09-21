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
  if (!descriptionText || typeof descriptionText !== 'string') return null;
  const cleanDesc = descriptionText.trim();
  if (cleanDesc.length === 0) return null;

  const descVector = generateEmbedding(cleanDesc);
  const archetypeVectors = getArchetypeVectors();

  let bestMatch = null;
  let highestSim = 0;

  for (const item of archetypeVectors) {
    const sim = cosineSimilarity(descVector, item.vector);
    if (sim > highestSim) {
      highestSim = sim;
      bestMatch = item.archetype;
    }
  }

  const isSimilaritySufficient = highestSim >= minSimilarity;
  if (isSimilaritySufficient && bestMatch) {
    return {
      archetype: bestMatch,
      similarity: Number(highestSim.toFixed(4))
    };
  }

  return null;
};
