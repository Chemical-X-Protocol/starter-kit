// Content anchoring helpers for the ground-truth labels: an anchor is the verbatim text of a code span,
// found again by content so labels survive line shifts. Blank lines and indentation do not matter.
import crypto from 'node:crypto';

export const parseAnchorSpec = (spec) => {
  const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(spec);
  if (!match) throw new Error(`bad anchor spec: ${spec}`);
  const startLine = Number(match[2]);
  const endLine = match[3] ? Number(match[3]) : startLine;
  return { file: match[1], startLine, endLine };
};

export const normalizeLines = (lines) => lines.map((line) => line.trim()).filter((line) => line.length > 0);

export const excerptHash = (lines) => crypto.createHash('sha256').update(normalizeLines(lines).join('\n')).digest('hex').slice(0, 16);

const indexNonBlank = (fileLines) => {
  const kept = [];
  fileLines.forEach((line, index) => {
    const text = line.trim();
    const hasContent = text.length > 0;
    if (hasContent) kept.push({ text, line: index + 1 });
  });
  return kept;
};

const matchesAt = (kept, needle, offset) => needle.every((text, i) => kept[offset + i].text === text);

// Returns { startLine, endLine } of the excerpt inside fileLines (1-indexed), nearest to hintLine, or null.
export const locateExcerpt = (fileLines, excerptLines, hintLine = 1) => {
  const needle = normalizeLines(excerptLines);
  const kept = indexNonBlank(fileLines);
  const hits = [];
  for (let offset = 0; offset + needle.length <= kept.length; offset += 1) {
    if (matchesAt(kept, needle, offset)) hits.push({ startLine: kept[offset].line, endLine: kept[offset + needle.length - 1].line });
  }
  const distance = (hit) => Math.abs(hit.startLine - hintLine);
  return hits.reduce((best, hit) => (best === null || distance(hit) < distance(best) ? hit : best), null);
};

// Parses a fixture file into [{ id, spec, hash, lines }].
export const parseFixture = (text) => {
  const anchors = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^\/\/ @@ anchor (\S+) (\S+) sha=(\w+)$/.exec(line);
    if (header) {
      current = { id: header[1], spec: header[2], hash: header[3], lines: [] };
      anchors.push(current);
    } else if (line === '// @@ end') {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return anchors;
};
