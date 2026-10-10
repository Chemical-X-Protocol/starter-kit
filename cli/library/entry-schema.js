// Runtime guard for library/<facet>/<id>/entry.json (engine doc, Library: KIT LAYOUT). No schema library:
// validateEntry returns a list of problems, empty when the entry is well formed.
export const ENTRY_ROLES = Object.freeze(['piece', 'resolution', 'convention', 'exemplar']);
export const ENTRY_STATUSES = Object.freeze(['verified', 'quarantined', 'retired']);
export const HOLE_KINDS = Object.freeze(['name', 'wording', 'type']);
export const FP_LEVELS = Object.freeze(['l1', 'l2', 'l3']);
export const NEGATIVE_EXPECTATIONS = Object.freeze(['noMatch', 'reports']);

const SEMVER = /^\d+\.\d+\.\d+$/;
const FP_HEX = /^[0-9a-f]{16}$/;
const LOCATE_KEYS = ['identifier', 'commentText', 'stringLiteral'];
const TEXT_FIELDS = ['id', 'exportName', 'defaultModule', 'signature', 'provenance'];
const LIST_FIELDS = ['params', 'holes', 'aliases', 'canonicalFor', 'conflictsResolved', 'negatives'];

const isText = (value) => typeof value === 'string' && value.length > 0;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const failedMessages = (checks) => checks.filter(([isOk]) => !isOk).map(([, message]) => message);

const textProblems = (entry) => TEXT_FIELDS.filter((key) => !isText(entry[key])).map((key) => `${key} must be a non-empty string`);
const listProblems = (entry) => LIST_FIELDS.filter((key) => !Array.isArray(entry[key])).map((key) => `${key} must be an array`);

const scalarProblems = (entry) => failedMessages([
  [SEMVER.test(entry.version ?? ''), 'version must be semver (x.y.z)'],
  [ENTRY_ROLES.includes(entry.role), `role must be one of ${ENTRY_ROLES.join(', ')}`],
  [ENTRY_STATUSES.includes(entry.status), `status must be one of ${ENTRY_STATUSES.join(', ')}`]
]);

const facetProblems = (facet) => {
  const isValid = isRecord(facet) && isText(facet.lang) && isText(facet.runtime) && isText(facet.framework);
  return failedMessages([[isValid, 'facet must be { lang, runtime, framework }, each a non-empty string']]);
};

const fpProblems = (fp) => {
  const isValid = isRecord(fp) && FP_LEVELS.every((level) => FP_HEX.test(fp[level] ?? ''));
  return failedMessages([[isValid, 'fp must be { l1, l2, l3 }, each 16 lowercase hex characters']]);
};

const stampProblems = (stamp) => {
  const isValid = isRecord(stamp) && Number.isInteger(stamp.version) && isText(stamp.revisionsHash);
  const isExtractorValid = stamp?.extractor === undefined || Number.isInteger(stamp.extractor);
  return failedMessages([[isValid && isExtractorValid, 'verifiedRuleset must be { version, revisionsHash, extractor? } with integer version and extractor']]);
};

const holeProblems = (hole, index) => {
  const label = `holes[${index}]`;
  const isObject = isRecord(hole);
  const locateCount = isObject && isRecord(hole.locate) ? LOCATE_KEYS.filter((key) => isText(hole.locate[key])).length : 0;
  return failedMessages([
    [isObject && isText(hole.id), `${label}.id must be a non-empty string`],
    [isObject && HOLE_KINDS.includes(hole.kind), `${label}.kind must be one of ${HOLE_KINDS.join(', ')}`],
    [isObject && typeof hole.default === 'string', `${label}.default must be a string`],
    [locateCount === 1, `${label}.locate must name exactly one of ${LOCATE_KEYS.join(', ')}`]
  ]);
};

const negativeProblems = (negative, index) => {
  const label = `negatives[${index}]`;
  const isObject = isRecord(negative);
  const isReport = isObject && negative.expect === 'reports';
  return failedMessages([
    [isObject && isText(negative.file), `${label}.file must be a non-empty string`],
    [isObject && NEGATIVE_EXPECTATIONS.includes(negative.expect), `${label}.expect must be one of ${NEGATIVE_EXPECTATIONS.join(', ')}`],
    [!isReport || isText(negative.rule), `${label}.rule is required when expect is "reports"`]
  ]);
};

const aliasProblems = (alias, index) => {
  const isValid = isRecord(alias) && FP_HEX.test(alias.fp ?? '') && FP_LEVELS.includes(alias.level) && isText(alias.source);
  return failedMessages([[isValid, `aliases[${index}] must be { fp, level, source, from? }`]]);
};

const mapList = (list, check) => (Array.isArray(list) ? list.flatMap(check) : []);

/** Problems with an entry object (empty list = valid). */
export const validateEntry = (entry) => {
  const isObject = isRecord(entry);
  const parts = isObject ? [
    textProblems(entry),
    scalarProblems(entry),
    facetProblems(entry.facet),
    fpProblems(entry.fp),
    stampProblems(entry.verifiedRuleset),
    listProblems(entry),
    mapList(entry.holes, holeProblems),
    mapList(entry.negatives, negativeProblems),
    mapList(entry.aliases, aliasProblems)
  ] : [['entry must be a JSON object']];
  return parts.flat();
};
