// Which group a `chemx blueprint` argument names: a group id prefix, or a ground-truth item (--item=A7).
// An item resolves to the surfaced group that touches most of its labeled anchors, the lower rank first,
// with the fewest members outside the item first, then the lower rank, so the answer is a group
// `chemx patterns --forge` lists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byCodePoint } from './group-shape.js';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LABELS = path.join(KIT_ROOT, 'cli', 'patterns', 'fixtures', 'gt', 'labels.json');

const readLabels = () => JSON.parse(fs.readFileSync(LABELS, 'utf-8'));

const touches = (group, anchor) => group.instances.some((instance) => instance.file === anchor.file && instance.startLine <= anchor.endLine && instance.endLine >= anchor.startLine);

/** The accepted group whose id starts with the hex prefix: { group } or { error }. */
export const groupByPrefix = (groups, prefix) => {
  const isUsable = /^[0-9a-f]{4,16}$/.test(prefix ?? '');
  if (!isUsable) return { error: 'a group id is 4 to 16 hex characters (see `chemx patterns --forge`)' };
  const found = groups.filter((group) => group.id.startsWith(prefix));
  const isUnique = found.length === 1;
  if (isUnique) return { group: found[0] };
  return { error: found.length === 0 ? `no accepted group ${prefix}` : `group id ${prefix} is ambiguous` };
};

/** The surfaced group of a ground-truth item id (A7): { group, item } or { error }. */
export const groupByItem = (groups, itemId, labels = readLabels()) => {
  const item = labels.items.find((entry) => entry.id === itemId);
  const isUnknown = !item;
  if (isUnknown) return { error: `no ground-truth item ${itemId}` };
  const scored = groups
    .filter((group) => group.rank !== null && group.rank !== undefined)
    .map((group) => {
      const hits = item.anchors.filter((anchor) => touches(group, anchor)).length;
      const extras = group.instances.filter((instance) => !item.anchors.some((anchor) => touches({ instances: [instance] }, anchor))).length;
      return { group, hits, extras };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.extras - b.extras || a.group.rank - b.group.rank || byCodePoint(a.group.id, b.group.id));
  const isUntouched = scored.length === 0;
  if (isUntouched) return { error: `no surfaced group touches ${itemId} (is the working tree the kit?)` };
  return { group: scored[0].group, item };
};
