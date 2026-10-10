// `chemx blueprint <group-id|bp-id> | --item=A7 [--json]`, `chemx blueprint holes <target>` and
// `chemx blueprint fill <target> id=value ... --as=@handle` (design doc, Surfaces). The target is a group
// id prefix (from `chemx patterns --forge`), a stored blueprint id, or a ground-truth item. Showing a
// blueprint refreshes the ledger, builds it from the group and stores it by id; the same group in the same
// state always yields the same bytes.
import fs from 'node:fs';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { resolveIndexRoot } from '../search-root.js';
import { syncFingerprints } from './fingerprint-sync.js';
import { runForgeGroups, readLedger } from './forge-groups.js';
import { createFacetResolver } from './facets.js';
import { createBlueprintContext } from './blueprint-context.js';
import { buildBlueprint, canonicalJson, withFills } from './blueprint.js';
import { loadMatchableEntries } from './library-match.js';
import { groupByPrefix, groupByItem } from './blueprint-target.js';
import { saveBlueprint, readBlueprint, readFills, validateFill, saveFill } from './blueprint-store.js';

const SHOWN_REJECTED = 8;
const SUBCOMMANDS = new Set(['holes', 'fill']);

const flagValue = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const write = (lines) => process.stdout.write(`${lines.join('\n')}\n`);

/** { sub, target, item, pairs, json, agent } from argv. */
export const parseBlueprintArgs = (args) => {
  const sub = SUBCOMMANDS.has(args[0]) ? args[0] : 'show';
  const rest = sub === 'show' ? args : args.slice(1);
  const positional = rest.filter((arg) => !arg.startsWith('-'));
  const pairs = sub === 'fill' ? positional.filter((arg) => arg.includes('=')) : [];
  const target = positional.find((arg) => !arg.includes('=')) ?? null;
  return { sub, target, item: flagValue(args, 'item') ?? null, pairs, json: args.includes('--json'), agent: flagValue(args, 'as') ?? process.env.CHEMX_AGENT_ID ?? '' };
};

const fileReaderAt = (root) => (relativePath) => {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  } catch {
    return null;
  }
};

const contextFor = (db, cwd, groups = []) => {
  const root = resolveIndexRoot(cwd);
  const resolver = createFacetResolver(root);
  return createBlueprintContext({ root, ledger: readLedger(db), groups, readFile: fileReaderAt(root), entries: loadMatchableEntries(), packageRootOfFile: resolver.packageRootOfFile });
};

const siteLine = (site) => `    ${site.file}:${site.range[0]}-${site.range[1]}`;

const holeSummary = (hole) => `${hole.id} (${hole.tier}${hole.default === null ? ', open' : `, default ${JSON.stringify(hole.default)}`})`;

/** Human lines for a blueprint with its fills applied. */
export const blueprintLines = (blueprint) => {
  const piece = blueprint.piece;
  const where = piece.module ? `${piece.module}${piece.moduleIsNew ? ' (new)' : ''}` : 'no module';
  const head = [blueprint.id, blueprint.kind, piece.name, `-> ${where}`].join(' ');
  const counts = `${blueprint.evidence.instances} sites/${blueprint.evidence.files} files`;
  const rejected = blueprint.evidence.rejectedMembers;
  return [
    `${head} | ${counts} | needs ${blueprint.needs}${blueprint.autoApplicable ? ' auto' : ''} | group ${blueprint.group}`,
    ...(piece.fromPiece ? [`  library piece ${piece.fromPiece}${piece.existing ? ` (already in the project: ${piece.existing})` : ''}`] : []),
    `  placement: ${piece.placementReason}`,
    '  sites:', ...blueprint.callSites.map(siteLine),
    ...(rejected.length > 0 ? ['  rejected members (left as they are):', ...rejected.slice(0, SHOWN_REJECTED).map((entry) => `    ${entry.at}  ${entry.reason}`), ...(rejected.length > SHOWN_REJECTED ? [`    +${rejected.length - SHOWN_REJECTED} more (--json lists all)`] : [])] : []),
    ...(blueprint.drift.length > 0 ? ['  drift (similar spans that differ):', ...blueprint.drift.map((span) => `    ${span.at}`)] : []),
    `  holes: ${blueprint.holes.map(holeSummary).join(', ')}`,
    `  next: chemx blueprint holes ${blueprint.id}; chemx blueprint fill ${blueprint.id} <hole>=<value> --as=@you`
  ];
};

const holeLines = (blueprint) => blueprint.holes.flatMap((hole) => [
  `${hole.id} ${hole.kind} ${hole.tier}${hole.default === null ? ' open' : ''}`,
  ...(hole.default === null ? [] : [`  default: ${hole.default}`]),
  ...(hole.candidates.length > 0 ? [`  candidates: ${hole.candidates.join(' | ')}`] : []),
  `  constraints: ${JSON.stringify(hole.constraints)}`
]);

// A group id builds the blueprint; a stored blueprint id reads it back (fills applied by the caller).
// options: { target, item }. Shared with `chemx heal` (heal-cli.js).
export const resolveBlueprint = (db, cwd, options) => {
  const isStoredId = options.target?.startsWith('bp_');
  if (isStoredId) return readBlueprint(db, options.target);
  syncFingerprints(cwd, { targetDir: null, includeTests: false });
  const grouped = runForgeGroups(cwd, {});
  const hasRun = Boolean(grouped);
  if (!hasRun) return { error: 'no index db here (run chemx q once to create it)' };
  const found = options.item ? groupByItem(grouped.groups, options.item) : groupByPrefix(grouped.groups, options.target);
  const isUnresolved = Boolean(found.error);
  if (isUnresolved) return { error: found.error };
  const blueprint = buildBlueprint(found.group, contextFor(db, cwd, grouped.groups));
  saveBlueprint(db, blueprint);
  return { blueprint };
};

export const fillContextOf = (db, cwd, blueprint) => {
  const context = contextFor(db, cwd);
  return { declaredIn: context.declaredIn, files: blueprint.locks };
};

const runFill = (db, cwd, blueprint, options) => {
  const isAnonymous = !options.agent.startsWith('@');
  if (isAnonymous) return { ok: false, code: 1, error: 'usage: chemx blueprint fill <target> <hole>=<value> --as=@handle' };
  const fillContext = fillContextOf(db, cwd, blueprint);
  const results = options.pairs.map((pair) => {
    const at = pair.indexOf('=');
    const holeId = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const verdict = validateFill(blueprint, holeId, value, fillContext);
    const isValid = verdict.ok;
    if (isValid) saveFill(db, blueprint.id, holeId, value, `human:${options.agent}`);
    return { holeId, value, ...verdict };
  });
  const refused = results.filter((entry) => !entry.ok);
  write(results.map((entry) => (entry.ok ? `filled ${entry.holeId} = ${entry.value}` : `refused ${entry.holeId}: ${entry.reason}`)));
  return { ok: refused.length === 0, code: refused.length === 0 ? 0 : 1, results };
};

const PRINTERS = {
  holes: (blueprint) => holeLines(blueprint).join('\n'),
  show: (blueprint, options) => (options.json ? canonicalJson(blueprint).trimEnd() : blueprintLines(blueprint).join('\n'))
};

/** Runs the command; returns { ok, ... } and prints. */
export const runBlueprintCli = (args, cwd = process.cwd()) => {
  const options = parseBlueprintArgs(args);
  const hasTarget = Boolean(options.target) || Boolean(options.item);
  const isMissingTarget = !hasTarget;
  if (isMissingTarget) {
    write(['usage: chemx blueprint <group-id|bp-id> | --item=<A7> [--json]', '       chemx blueprint holes <target>', '       chemx blueprint fill <target> <hole>=<value> --as=@handle']);
    return { ok: false, code: 1, error: 'no target' };
  }
  const db = openIndexDb(cwd);
  const hasDb = Boolean(db);
  if (!hasDb) {
    write(['blueprint: no index db here (run chemx q once to create it)']);
    return { ok: false, code: 1, error: 'no index db' };
  }
  const resolved = resolveBlueprint(db, cwd, options);
  const isFailed = Boolean(resolved.error);
  if (isFailed) {
    write([`blueprint: ${resolved.error}`]);
    return { ok: false, code: 1, error: resolved.error };
  }
  const { blueprint } = resolved;
  const isFill = options.sub === 'fill';
  if (isFill) return runFill(db, cwd, blueprint, options);
  const filled = withFills(blueprint, readFills(db, blueprint.id));
  const text = PRINTERS[options.sub](filled, options);
  process.stdout.write(`${text}\n`);
  return { ok: true, blueprint: filled };
};
