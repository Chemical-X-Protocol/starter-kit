// Chemical X In-Process Semantic Vectorizer
export const VECTOR_DIMENSIONS = 128;

const hashString = (str, seed = 0) => {
  let h = seed ^ 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0);
};

const tokenize = (text) => {
  const isInvalidText = !text || typeof text !== "string";
  if (isInvalidText) return [];
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_$-]+/)
    .filter((t) => t.length > 1);
};

export const generateEmbedding = (text) => {
  const vec = new Float32Array(VECTOR_DIMENSIONS);
  const tokens = tokenize(text);
  const isEmpty = tokens.length === 0;
  if (isEmpty) return vec;

  for (const token of tokens) {
    const tokenBucket = hashString(token) % VECTOR_DIMENSIONS;
    vec[tokenBucket] += 2.0;

    const padded = `_${token}_`;
    for (let i = 0; i < padded.length - 2; i++) {
      const trigram = padded.slice(i, i + 3);
      const triBucket = hashString(trigram, 42) % VECTOR_DIMENSIONS;
      vec[triBucket] += 1.0;
    }
  }

  let normSq = 0;
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  const hasNorm = norm > 0;
  if (hasNorm) {
    for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
};

export const serializeVector = (vec) => {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
};

export const deserializeVector = (buf) => {
  if (!buf) return new Float32Array(VECTOR_DIMENSIONS);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

export const cosineSimilarity = (vecA, vecB) => {
  const isComparable = Boolean(vecA) && Boolean(vecB) && vecA.length === vecB.length;
  if (!isComparable) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dot));
};
