import test from "node:test";
import assert from "node:assert";
import { openIndexDb } from "./search-schema.js";
import { upsertFileIndex } from "./search-db.js";
import { querySemanticIndex, queryHybridIndex } from "./search-queries.js";
import {
  generateEmbedding,
  serializeVector,
  deserializeVector,
  cosineSimilarity,
  VECTOR_DIMENSIONS
} from "./embeddings/vectorizer.js";

test("vectorizer: generates normalized 128-dimensional float vector", () => {
  const vec = generateEmbedding("button click modal backdrop blur");
  assert.strictEqual(vec.length, VECTOR_DIMENSIONS);
  assert.strictEqual(vec instanceof Float32Array, true);

  // Check L2 normalization
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  assert.ok(Math.abs(norm - 1.0) < 0.001, "Vector should be unit length (~1.0)");
});

test("vectorizer: serialization and deserialization roundtrip", () => {
  const vec = generateEmbedding("session auth token store");
  const buffer = serializeVector(vec);
  assert.strictEqual(buffer instanceof Buffer, true);
  assert.strictEqual(buffer.length, VECTOR_DIMENSIONS * 4);

  const restored = deserializeVector(buffer);
  assert.strictEqual(restored.length, VECTOR_DIMENSIONS);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    assert.strictEqual(Math.abs(vec[i] - restored[i]) < 0.0001, true);
  }
});

test("vectorizer: cosine similarity scoring", () => {
  const vecA = generateEmbedding("modal dialog popup window");
  const vecB = generateEmbedding("modal popup dialog");
  const vecC = generateEmbedding("database sqlite table column");

  const simHigh = cosineSimilarity(vecA, vecB);
  const simLow = cosineSimilarity(vecA, vecC);

  assert.ok(simHigh > simLow, "Related concepts must have higher similarity than unrelated concepts");
  assert.ok(simHigh > 0.5, "Close semantic queries should score above 0.5");
});

test("search: semantic and hybrid index queries", () => {
  const db = openIndexDb();
  if (!db) return;

  upsertFileIndex(db, {
    path: "src/ui/atoms/a-glass-card/a-glass-card.vue",
    mtime: Date.now(),
    size: 250,
    tier: "atom",
    lines: 25,
    chars: 500,
    symbols: [{ name: "GlassCard", kind: "const", isExport: true }],
    props: [{ name: "backdropBlur", type: "boolean" }, { name: "elevation", type: "number" }],
    hooks: [],
    imports: []
  });

  upsertFileIndex(db, {
    path: "src/ui/molecules/m-auth-form/m-auth-form.vue",
    mtime: Date.now(),
    size: 350,
    tier: "molecule",
    lines: 45,
    chars: 900,
    symbols: [{ name: "AuthForm", kind: "const", isExport: true }],
    props: [{ name: "sessionToken", type: "string" }],
    hooks: ["useSessionStore"],
    imports: []
  });

  // Query semantic index for glass card concepts
  const glassMatches = querySemanticIndex(db, "glass card backdrop blur", { limit: 5 });
  assert.ok(glassMatches.length > 0, "Should find semantic matches");
  assert.strictEqual(glassMatches[0].filePath.includes("glass-card"), true, "GlassCard should rank top for glass query");

  // Query hybrid index
  const hybridMatches = queryHybridIndex(db, "AuthForm sessionToken", { limit: 5 });
  assert.ok(hybridMatches.length > 0, "Hybrid search should return results");
  assert.strictEqual(hybridMatches[0].filePath.includes("auth-form"), true, "AuthForm should rank top in hybrid search");
});
