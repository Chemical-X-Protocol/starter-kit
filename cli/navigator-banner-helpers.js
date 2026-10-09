export const visualWidth = (s) => {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const seg of new Intl.Segmenter().segment(stripped)) {
    const char = seg.segment;
    const isDoubleWidth = char === "❤️" || char === "🖤" || char.codePointAt(0) > 0x1f000;
    w += isDoubleWidth ? 2 : char.length;
  }
  return w;
};

export { resolveProjectName, resolveCostFigures } from "./audit/project-figures.js";

export const truncatePath = (p, maxLen) => {
  const isWithinLimit = p.length <= maxLen;
  if (isWithinLimit) return p;
  return `…${p.slice(p.length - maxLen + 1)}`;
};
