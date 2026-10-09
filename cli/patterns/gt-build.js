// Builds the ground-truth fixtures and labels.json from the item table in gt-locations.js.
// Run: node cli/patterns/gt-build.js   (reads the repo files, writes cli/patterns/fixtures/gt/)
// Fixtures hold verbatim excerpts with a provenance header (file:lines at labeling time, content hash).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GT_ITEMS } from './gt-locations.js';
import { parseAnchorSpec, excerptHash } from './gt-text.js';

export const LABELS_SCHEMA = 'chemx.gt-labels/1';

const readSpan = (root, spec) => {
  const { file, startLine, endLine } = parseAnchorSpec(spec);
  const lines = fs.readFileSync(path.join(root, file), 'utf-8').split('\n').slice(startLine - 1, endLine);
  return { file, startLine, endLine, lines };
};

const buildAnchor = (root, itemId, spec, ordinal) => {
  const span = readSpan(root, spec);
  const hash = excerptHash(span.lines);
  return { anchor: { id: `${itemId}.${ordinal}`, file: span.file, startLine: span.startLine, endLine: span.endLine, hash }, lines: span.lines };
};

const fixtureText = (item, built) => {
  const out = [`// gt fixture ${item.id} (class ${item.class}): ${item.title}`];
  for (const { anchor, lines } of built) {
    out.push(`// @@ anchor ${anchor.id} ${anchor.file}:${anchor.startLine}-${anchor.endLine} sha=${anchor.hash}`, ...lines, '// @@ end');
  }
  return `${out.join('\n')}\n`;
};

const labelItem = (item, anchors) => {
  const { anchors: _specs, ...rest } = item;
  return { ...rest, anchors };
};

export const buildGroundTruth = (root, outDir) => {
  const labels = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const item of GT_ITEMS) {
    const built = item.anchors.map((spec, index) => buildAnchor(root, item.id, spec, index + 1));
    fs.writeFileSync(path.join(outDir, `${item.id}.txt`), fixtureText(item, built));
    labels.push(labelItem(item, built.map((entry) => entry.anchor)));
  }
  const document = { schema: LABELS_SCHEMA, source: 'docs/superpowers/reviews/2026-10-09-forge-groundtruth.md', items: labels };
  fs.writeFileSync(path.join(outDir, 'labels.json'), `${JSON.stringify(document, null, 2)}\n`);
  return document;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const document = buildGroundTruth(path.resolve(HERE, '..', '..'), path.join(HERE, 'fixtures', 'gt'));
  process.stdout.write(`gt-build: ${document.items.length} items\n`);
}
