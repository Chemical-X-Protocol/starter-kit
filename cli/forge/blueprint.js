// Blueprints (engine doc, Blueprint: SCHEMA chemx.blueprint/1): the plan to heal one accepted group.
// Canonical JSON (sorted keys, LF, no timestamps); id = 'bp_' + sha256(body without id/status)[0..12]. The
// body depends on the extractor version, the members' content hashes and offsets, the LGG summary, the
// placement and the library piece@version, never on the ruleset, the clock or the input order.
// Scope of this build: naming, placement, kind, holes, needs, rejected members and call sites. The
// piece body is the library piece's code for a matched group; for any other group it is null (the heal
// engine, P6, writes it from the home member and the LGG), and behaviorDelta is always empty.
import crypto from 'node:crypto';
import path from 'node:path';
import { FORGE_EXTRACTOR_VERSION } from './store.js';
import { byCodePoint, byLocation, sharedAnchors } from './group-shape.js';
import { packageRootOfKey } from './facets.js';
import { nameGroup, tokensOf, isIdentifier } from './naming.js';
import { placeGroup, kindOf, hookNameOf, langOfKey, runtimeOfKey } from './placement.js';
import { matchLibrary, pieceExistsIn } from './library-match.js';
import { findRejectedMembers } from './rejected-members.js';

export const BLUEPRINT_SCHEMA = 'chemx.blueprint/1';

const TIER_RANK = { light: 0, standard: 1, deep: 2 };
const TIERS = ['light', 'standard', 'deep'];
const KIND_FLOORS = { 'extract-function': 'light', reuse: 'light', tabulate: 'light', 'extract-component': 'standard', 'extract-composable': 'standard', 'extract-hook': 'standard', advisory: 'deep' };
const HOLE_FLOORS = { name: 'light', wording: 'light', literal: 'light', type: 'standard', variant: 'standard', decision: 'standard', design: 'deep' };
const FUNCTION_KINDS = new Set(['extract-function', 'extract-composable', 'extract-hook']);
const PARAM_KINDS = new Set(['literal', 'value', 'ref', 'expr', 'key', 'capture']);
const LIGHT_MAX_FILES = 6;
const STANDARD_MAX_FILES = 15;
const DOC_MAX_LENGTH = 120;
const ROUND = 10000;

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  const isPlain = value !== null && typeof value === 'object';
  if (!isPlain) return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort(byCodePoint).map((key) => [key, sortKeys(value[key])]));
};

/** Canonical JSON text: sorted keys at every depth, two-space indent, LF, one trailing newline. */
export const canonicalJson = (value) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

/** 'bp_' + the first 12 hex characters of sha256 over the canonical body (id and status excluded). */
export const blueprintIdOf = (body) => {
  const { id, status, ...rest } = body;
  return `bp_${crypto.createHash('sha256').update(canonicalJson(rest)).digest('hex').slice(0, 12)}`;
};

const round = (number) => Math.round(number * ROUND) / ROUND;

const atOf = (span) => `${span.file}:${span.startLine}-${span.endLine}`;

const maxTier = (tiers) => TIERS[Math.max(0, ...tiers.map((tier) => TIER_RANK[tier]))];

const unique = (list) => [...new Set(list)].sort(byCodePoint);

const facetOf = (group) => ({
  lang: langOfKey(group.facetKey),
  runtime: runtimeOfKey(group.facetKey),
  spec: group.facetKey.split(':')[2] === 'spec',
  packageRoot: packageRootOfKey(group.facetKey)
});

const lggSummaryOf = (lgg) => (lgg ? {
  memberCount: lgg.memberCount,
  rootType: lgg.rootType,
  holeRatio: round(lgg.holeRatio),
  holes: lgg.holes.map((hole) => ({ id: hole.id, kind: hole.kind, occurrences: hole.occurrences, examples: hole.examples }))
} : null);

const identifierOf = (text) => {
  const candidate = String(text ?? '').trim();
  return isIdentifier(candidate) ? candidate : null;
};

// Param names: a library piece's own; else the identifier the hole's first example holds, else argN.
const paramsOf = (group, library) => {
  if (library) return library.params.map((param) => ({ name: param.name, kind: param.kind, type: param.type ?? null }));
  const holes = (group.lgg?.holes ?? []).filter((hole) => PARAM_KINDS.has(hole.kind));
  const used = new Set();
  return holes.map((hole, index) => {
    const preferred = identifierOf(hole.examples[0]) ?? `arg${index + 1}`;
    const name = used.has(preferred) ? `${preferred}${index + 1}` : preferred;
    used.add(name);
    return { name, kind: hole.kind, hole: hole.id, values: hole.examples };
  });
};

const signatureOf = (kind, name, params) => {
  const list = params.map((param) => param.name).join(', ');
  const isArrow = kind === 'extract-function';
  const isHookKind = kind === 'extract-composable' || kind === 'extract-hook';
  if (isArrow) return `export const ${name} = (${list}) =>`;
  return isHookKind ? `export function ${name}(${list})` : null;
};

const specifierOf = (from, module) => {
  const relative = path.posix.relative(path.posix.dirname(from), module);
  return relative.startsWith('.') ? relative : `./${relative}`;
};

const callSitesOf = ({ instances, name, kind, module, context }) => instances.map((instance) => {
  const row = context.rowsById.get(instance.unitIds[0]);
  const needsImport = FUNCTION_KINDS.has(kind) && instance.file !== module;
  return {
    file: instance.file,
    range: [instance.startLine, instance.endLine],
    contentHash: context.contentHashes.get(instance.file) ?? null,
    memberFp: row?.fp2 ?? null,
    addImport: needsImport ? { from: specifierOf(instance.file, module), names: [name] } : null
  };
});

const docDefaultOf = (name, count, library) => {
  const fromLibrary = library?.holes.find((hole) => hole.kind === 'wording')?.default;
  const phrase = tokensOf(name).join(' ');
  return fromLibrary ?? `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}, shared by ${count} call sites.`;
};

const holesOf = ({ name, naming, group, drift, placement, kind, library, count }) => {
  const isAdvisory = kind === 'advisory';
  const holes = [{
    id: 'name', kind: 'name', tier: 'light', default: name, candidates: naming.candidates,
    constraints: { identifier: true, noCollision: 'declarations in the piece module and the member files' }
  }];
  if (!isAdvisory) {
    holes.push({
      id: 'doc', kind: 'wording', tier: 'light', default: docDefaultOf(name, count, library), candidates: [],
      constraints: { maxLen: DOC_MAX_LENGTH, rules: ['TYPOGRAPHY_EM_DASH', 'AI_SLOP_*'] }
    });
  }
  for (const hole of (group.lgg?.holes ?? []).filter((entry) => entry.kind === 'transform')) {
    holes.push({ id: `variant-${hole.id}`, kind: 'variant', tier: 'standard', default: 'identity', candidates: ['identity'], constraints: { examples: hole.examples } });
  }
  const hasDrift = drift.length > 0;
  if (hasDrift) {
    holes.push({
      id: 'drift-adoption', kind: 'decision', tier: 'standard', default: null, candidates: ['adopt', 'keep', 'skip'],
      constraints: { prompt: `${drift.length} similar span${drift.length === 1 ? '' : 's'} differ from the members (${drift.slice(0, 3).map((span) => span.at).join(', ')}); adopt the piece there, keep them, or skip`, spans: drift.map((span) => span.at) }
    });
  }
  const isUnplaced = !placement.ok;
  if (isUnplaced) {
    holes.push({ id: 'placement', kind: 'design', tier: 'deep', default: null, candidates: [], constraints: { reason: placement.reason } });
  }
  return holes;
};

const SIZE_TIERS = [[STANDARD_MAX_FILES, 'deep'], [LIGHT_MAX_FILES, 'standard']];

const sizeTierOf = (fileCount) => SIZE_TIERS.find(([limit]) => fileCount > limit)?.[1] ?? 'light';

const needsOf = ({ kind, holes, fileCount, drift, behaviorDelta, hasCoveringSpec, placement, group }) => {
  const isInFileTable = kind === 'tabulate' && fileCount === 1;
  const kindFloor = kind === 'tabulate' && !isInFileTable ? 'standard' : KIND_FLOORS[kind];
  const holeTiers = holes.map((hole) => HOLE_FLOORS[hole.kind] ?? 'standard');
  const sizeTier = sizeTierOf(fileCount);
  const escalations = [
    ...(drift.length > 0 || behaviorDelta.length > 0 ? ['standard'] : []),
    ...(hasCoveringSpec ? [] : ['standard']),
    ...(placement.ok ? [] : ['deep']),
    ...(group.path === 'N3' && group.lgg?.holes.length > 1 ? ['standard'] : [])
  ];
  return maxTier([kindFloor, sizeTier, ...holeTiers, ...escalations]);
};

/**
 * The blueprint of one accepted group (a group from runForgeGroups). context: createBlueprintContext().
 * Returns the blueprint object, id included; use canonicalJson() for its text.
 */
export const buildBlueprint = (group, context) => {
  const instances = [...group.instances].sort(byLocation);
  const ownDrift = group.drift ?? [];
  const driftSpans = [...new Map([...ownDrift, ...context.relatedDriftOf(group)].sort(byLocation).map((span) => [`${span.file}:${span.startLine}`, span])).values()];
  const ordered = { ...group, instances, drift: driftSpans.sort(byLocation) };
  const files = unique(instances.map((instance) => instance.file));
  const library = matchLibrary(ordered, context.entries);
  const libraryExists = library !== null && pieceExistsIn(context.root, library);
  const provisionalKind = kindOf({ group: ordered, facetKey: group.facetKey, libraryExists });
  const taken = context.declaredIn(files);
  const named = nameGroup(ordered, { enclosingNameOf: context.enclosingNameOf, takenNames: taken }, library);
  const isHookKind = provisionalKind === 'extract-composable' || provisionalKind === 'extract-hook';
  const firstName = isHookKind ? hookNameOf(named.name) : named.name;
  const firstPlacement = placeGroup({ group: ordered, kind: provisionalKind, name: firstName, library }, context);
  const moduleTaken = firstPlacement.module ? context.declaredIn([firstPlacement.module]) : new Set();
  const naming = moduleTaken.has(firstName) ? nameGroup(ordered, { enclosingNameOf: context.enclosingNameOf, takenNames: new Set([...taken, ...moduleTaken]) }, library) : named;
  const name = isHookKind ? hookNameOf(naming.name) : naming.name;
  const placement = name === firstName ? firstPlacement : placeGroup({ group: ordered, kind: provisionalKind, name, library }, context);
  const kind = kindOf({ group: ordered, facetKey: group.facetKey, placementOk: placement.ok, libraryExists });
  const drift = ordered.drift.map((span) => ({ at: atOf(span), reason: span.reason ?? 'anchor subset' })).sort((a, b) => byCodePoint(a.at, b.at));
  const rejectedMembers = findRejectedMembers(ordered, context);
  const params = paramsOf(ordered, library);
  const holes = holesOf({ name, naming, group: ordered, drift, placement, kind, library, count: instances.length });
  const behaviorDelta = [];
  const coveringSpecs = unique(files.flatMap((file) => context.coveringSpecsOf(file)));
  const needs = needsOf({ kind, holes, fileCount: files.length, drift, behaviorDelta, hasCoveringSpec: coveringSpecs.length > 0, placement, group: ordered });
  const isAuto = needs === 'light' && holes.every((hole) => hole.default !== null) && behaviorDelta.length === 0 && drift.length === 0;
  const first = instances[0];
  const module = placement.module;
  const body = {
    schema: BLUEPRINT_SCHEMA,
    group: group.id,
    path: group.path,
    kind,
    facet: facetOf(group),
    extractor: FORGE_EXTRACTOR_VERSION,
    evidence: {
      instances: instances.length, files: files.length, mass: group.mass, anchorWeight: group.anchorWeight, E: round(group.evidence),
      holeRatio: round(group.lgg?.holeRatio ?? 0), anchors: sharedAnchors(instances), rejectedMembers
    },
    lgg: lggSummaryOf(group.lgg),
    piece: {
      name, module, moduleIsNew: placement.moduleIsNew, placement: placement.source, placementReason: placement.reason,
      export: FUNCTION_KINDS.has(kind) ? 'named-const' : null,
      fromPiece: library ? `${library.id}@${library.version}` : null,
      existing: libraryExists ? `${library.defaultModule}#${library.exportName}` : null,
      home: atOf(first), signature: signatureOf(kind, name, params), params,
      imports: library ? library.imports : [], body: library ? library.text : null
    },
    callSites: callSitesOf({ instances, name, kind, module, context }),
    children: [],
    dependsOn: unique(group.dependsOn ?? []),
    unblocks: [],
    drift,
    behaviorDelta,
    holes,
    verify: {
      parse: true,
      audit: 'all rules; zero introduced (rule:hazard delta) on touched files and on the new module',
      specs: { direct: coveringSpecs },
      postCondition: 're-fingerprint the touched files: the group has at most one instance left (the piece itself)'
    },
    locks: unique([...(module ? [module] : []), ...files]),
    needs,
    autoApplicable: isAuto,
    task: { rule: kind === 'reuse' ? 'PATTERN_REINVENTED' : 'PATTERN_EXTRACT', title: `${kind === 'reuse' ? 'Reuse' : 'Extract'} ${name} from ${instances.length} sites in ${files.length} file${files.length === 1 ? '' : 's'}` }
  };
  return { id: blueprintIdOf(body), ...body };
};

/** The blueprint with filled holes applied (fills: Map holeId -> value). The id is the unfilled one. */
export const withFills = (blueprint, fills) => {
  const name = fills.get('name') ?? blueprint.piece.name;
  const doc = fills.get('doc') ?? null;
  const piece = { ...blueprint.piece, name, ...(doc ? { doc } : {}) };
  return { ...blueprint, piece, fills: Object.fromEntries([...fills].sort(([a], [b]) => byCodePoint(a, b))) };
};
