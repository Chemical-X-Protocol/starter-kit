/** Compact outline formatter for minified or bundled scripts (Directive 1.A). */
const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const formatHtmlBlockMap = (sfc) => {
  const styleLines = (sfc.styles || []).map((s) => {
    const chars = s.charCount ?? s.content?.length ?? 0;
    const range = s.endLine ? `L${s.startLine}-${s.endLine}` : `L${s.startLine}`;
    return `// <style> ${range} (${formatKb(chars)})`;
  });
  const scriptLines = (sfc.scripts || []).map((s) => {
    const chars = s.charCount ?? s.content?.length ?? 0;
    const range = s.endLine ? `L${s.startLine}-${s.endLine}` : `L${s.startLine}`;
    const sourceKind = s.src ? `src="${s.src}"` : 'inline';
    return `// <script> ${range} (${formatKb(chars)}, ${sourceKind})`;
  });
  return [...styleLines, ...scriptLines];
};

export const formatMinifiedOutline = (filePath, sfc, minified) => {
  const kb = formatKb(minified.totalChars);
  const header = [
    `// Outline: ${filePath}`,
    `// Minified or bundled script detected (${kb}, ${minified.longLineCount} long line(s), max ${minified.maxLineLength} chars; first at L${minified.firstLongLine})`
  ];
  const blockLines = sfc ? formatHtmlBlockMap(sfc) : [];
  return [...header, ...blockLines].join('\n');
};
