// Pass test kit for PHP rule-family specs (design spec 3.4). Not shipped to npm.
import { parsePhp } from '../../php/php-parse.js';
import { linkParents, nodeLine } from '../../php/php-walk.js';

const DEFAULT_CONFIG = { rules: {}, overrides: [], wordpress: true };

/**
 * Builds the ctx a PHP pass receives. wp and index are null unless passed.
 * ctx.records collects what passes report; ctx.report(rule, nodeOrLine, hazard, extra).
 */
export function buildPassContext(code, { path = 'fixture.php', config = DEFAULT_CONFIG, index = null, wp = null, crossFile = true } = {}) {
  const parsed = parsePhp(code, { filePath: path });
  if (!parsed.ast) throw new Error(`buildPassContext: ${JSON.stringify(parsed)}`);
  linkParents(parsed.ast);
  const records = [];
  const report = (rule, nodeOrLine, hazard, extra = {}) => {
    const isLine = typeof nodeOrLine === 'number';
    const loc = !isLine && nodeOrLine && nodeOrLine.loc;
    records.push({
      rule,
      line: isLine ? nodeOrLine : nodeLine(nodeOrLine),
      column: loc ? loc.start.column : 0,
      ...(loc ? { endLine: loc.end.line } : {}),
      hazard,
      ...extra,
    });
  };
  return {
    ast: parsed.ast,
    comments: parsed.comments,
    content: code,
    lines: code.split('\n'),
    filePath: path,
    relativePath: path,
    config,
    settings: {},
    phpTarget: (config.php && config.php.version) || '8.3',
    wp,
    index,
    crossFile,
    report,
    records,
  };
}
