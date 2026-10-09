// Alias inlining switch (#2595). Inlining was unsound in every adversarial round, so it is OFF by
// default and only runs when CHEMX_FORGE_INLINE=1 is set for the process. The mode is part of the
// extractor version (see store.js), so switching it re-fingerprints the ledger.
export const isInlineRequested = (env = process.env) => env.CHEMX_FORGE_INLINE === '1';

export const INLINE_VERSION_OFFSET = 1000;
