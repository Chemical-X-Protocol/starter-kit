// Import this FIRST in a spec that pins the opt-in inlining pass (#2595). ESM evaluates imports in order, so
// the switch is on before store.js computes FORGE_EXTRACTOR_VERSION; the version stamp and the hashing mode
// then agree for the whole spec process (setting the env after the imports left them disagreeing).
process.env.CHEMX_FORGE_INLINE = '1';
