// Meta specs read the whole repository (every spec file, every help card, the docs) instead of
// importing what they check, so the import graph never selects them and a change can break one
// without any local run noticing until CI does. `chemx test --changed` adds them to every affected
// selection. A spec is meta when test-lanes.json lists it under "meta" ([{ glob, why }]) or one of
// its first lines is `// chemx: meta`.
import path from 'node:path';

const MARKER = /^\s*\/\/\s*chemx:\s*meta\b/;
const MARKER_LINES = 30;
export const META_REASON = 'meta spec: it scans the whole repo, so --changed always runs it';

const hasMarker = (text = '') => text.split('\n', MARKER_LINES).some((line) => MARKER.test(line));

// suite: Set of spec paths. texts: Map<path, source> (the dependency graph's). rules: the manifest's
// meta rules. Returns the sorted spec paths.
export const findMetaSpecs = (suite, texts, rules = []) => {
  const matchesRule = (spec) => rules.some((rule) => path.matchesGlob(spec, rule.glob));
  return [...suite].filter((spec) => matchesRule(spec) || hasMarker(texts.get(spec))).sort();
};

// Adds the meta specs to an affected selection ({ mode, specs: [{ path, reasons }], ... }) and lists
// them in `meta`. A full selection already runs everything; a selection with no meta spec is unchanged.
export const withMetaSpecs = (selection, meta) => {
  const isAffected = selection.mode === 'affected';
  const hasMeta = meta.length > 0;
  const addsMeta = isAffected && hasMeta;
  if (!addsMeta) return selection;
  const bySpec = new Map(selection.specs.map((spec) => [spec.path, spec]));
  for (const spec of meta) {
    const known = bySpec.get(spec);
    bySpec.set(spec, known ? { ...known, reasons: [...known.reasons, META_REASON] } : { path: spec, reasons: [META_REASON] });
  }
  const specs = [...bySpec.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { ...selection, specs, meta };
};
