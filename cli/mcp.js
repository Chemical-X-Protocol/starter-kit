import readline from 'node:readline';
import process from 'node:process';
import path from 'node:path';
import { syncSearchIndex } from './search.js';
import { openIndexDb, queryIndex } from './search-db.js';
import { readTokenOptimized } from './reader.js';
import { patchFile } from './patcher.js';
import { runAudit as executeAstAudit } from './audit.js';
import { handleCheckCommand } from './search-commands.js';

const SERVER_NAME = 'chemical-x-mcp';
const SERVER_VERSION = '26.9.15';
const PROTOCOL_VERSION = '2024-11-05';

const log = (...args) => {
  process.stderr.write(`[Chemical X MCP] ${args.join(' ')}\n`);
};

const TOOLS_MANIFEST = [
  {
    name: 'chemx_q',
    description: 'Chemical X AST-indexed query machine. Finds capsules, symbols, and files with token-minified outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or symbol name' },
        tier: {
          type: 'string',
          enum: ['atom', 'molecule', 'organism', 'template', 'view', 'hook', 'all'],
          description: 'Architectural tier filter'
        },
        inspect: { type: 'boolean', description: 'Include props and hooks breakdown' },
        limit: { type: 'integer', description: 'Maximum results to return (default: 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'chemx_read',
    description: 'Token-minified file reader. Extracts AST outlines, stripped comments, line ranges, or specific symbol blocks to minimize token consumption.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path' },
        outline: { type: 'boolean', description: 'Extract structural AST outline only (types/interfaces/exports, saves 80%+ tokens)' },
        symbol: { type: 'string', description: 'Extract only this symbol declaration and body' },
        stripComments: { type: 'boolean', description: 'Strip comments from output' },
        compact: { type: 'boolean', description: 'Collapse blank lines and trim spaces' },
        startLine: { type: 'integer', description: '1-based start line' },
        endLine: { type: 'integer', description: '1-based end line' }
      },
      required: ['path']
    }
  },
  {
    name: 'chemx_patch',
    description: 'Surgically patch a file using exact search and replace without dumping entire file contents into context.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target file path' },
        targetContent: { type: 'string', description: 'Exact string chunk to replace' },
        replacementContent: { type: 'string', description: 'New replacement content' },
        allowMultiple: { type: 'boolean', description: 'Allow multiple replacements' }
      },
      required: ['path', 'targetContent', 'replacementContent']
    }
  },
  {
    name: 'chemx_audit',
    description: 'Run Chemical X architectural health check on workspace or directory. Reports health grade, score, and critical hazards.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: "Directory to audit (defaults to 'src')" }
      }
    }
  },
  {
    name: 'chemx_check',
    description: 'Check single file or capsule against molecular boundary rules (line limits, raw DOM, 2-stage booleans).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or capsule path to verify' }
      },
      required: ['path']
    }
  }
];

const handleToolCall = async (name, args) => {
  switch (name) {
    case 'chemx_q': {
      const db = openIndexDb(process.cwd());
      if (!db) {
        syncSearchIndex('src', process.cwd());
      }
      const activeDb = openIndexDb(process.cwd());
      if (!activeDb) {
        throw new Error('Unable to initialize Chemical X AST search index database.');
      }

      const limit = args.limit || 20;
      const results = queryIndex(activeDb, {
        query: args.query,
        tier: args.tier || 'all',
        limit
      });

      if (args.inspect) {
        const compactResults = results.map((r) => ({
          path: r.path,
          tier: r.tier,
          lines: r.lines,
          symbols: r.symbols.map((s) => s.name),
          props: r.props.map((p) => p.name),
          hooks: r.hooks
        }));
        return JSON.stringify(compactResults, null, 2);
      }

      // Ultra-compact single-line summaries
      const lines = results.map((r) => {
        const mainSym = r.symbols.find((s) => s.isExport)?.name || '';
        const symPart = mainSym ? ` (${mainSym})` : '';
        const hookPart = r.hooks.length > 0 ? ` [${r.hooks.slice(0, 2).join(',')}]` : '';
        return `[${r.tier.toUpperCase()}] ${r.path}:${r.lines}L${symPart}${hookPart}`;
      });

      return lines.length > 0 ? lines.join('\n') : `No matching capsules or symbols for "${args.query}"`;
    }

    case 'chemx_read': {
      const res = readTokenOptimized(args.path, {
        outline: args.outline,
        symbol: args.symbol,
        stripComments: args.stripComments,
        compact: args.compact,
        startLine: args.startLine,
        endLine: args.endLine
      });

      const header = `// ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens)\n`;
      return header + res.content;
    }

    case 'chemx_patch': {
      const res = patchFile(args.path, {
        targetContent: args.targetContent,
        replacementContent: args.replacementContent,
        allowMultiple: args.allowMultiple
      });
      return JSON.stringify(res, null, 2);
    }

    case 'chemx_audit': {
      const targetDir = args.dir || 'src';
      const report = executeAstAudit(targetDir, { outputFile: null });
      const summary = {
        grade: report.health.grade,
        score: report.health.score,
        totalFiles: report.health.totalFiles,
        totalLines: report.health.totalLines,
        criticalViolations: report.violations.filter((v) => v.severity === 'CRITICAL').map((v) => `${v.file}:${v.line} [${v.ruleId}] ${v.message}`),
        highViolations: report.violations.filter((v) => v.severity === 'HIGH').slice(0, 10).map((v) => `${v.file}:${v.line} [${v.ruleId}] ${v.message}`),
      };
      return JSON.stringify(summary, null, 2);
    }

    case 'chemx_check': {
      const checkRes = handleCheckCommand(args.path, { isJson: true, isCli: false });
      return JSON.stringify(checkRes, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

/**
 * Starts the Chemical X Stdio MCP Server.
 */
export const startMcpServer = () => {
  log(`Starting Stdio JSON-RPC server (protocol v${PROTOCOL_VERSION})...`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const sendResponse = (response) => {
    process.stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (err) {
      log('Failed to parse incoming JSON message:', trimmed);
      return;
    }

    const { id, method, params } = message;

    // Notifications without ID
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        log('Client initialization handshake complete.');
      }
      return;
    }

    try {
      switch (method) {
        case 'initialize': {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION
              }
            }
          });
          break;
        }

        case 'ping': {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {}
          });
          break;
        }

        case 'tools/list': {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              tools: TOOLS_MANIFEST
            }
          });
          break;
        }

        case 'tools/call': {
          const { name, arguments: toolArgs } = params || {};
          try {
            const toolResult = await handleToolCall(name, toolArgs || {});
            sendResponse({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: String(toolResult)
                  }
                ],
                isError: false
              }
            });
          } catch (toolErr) {
            const errorMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            log(`Tool ${name} failed:`, errorMsg);
            sendResponse({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `Error executing ${name}: ${errorMsg}`
                  }
                ],
                isError: true
              }
            });
          }
          break;
        }

        default: {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            }
          });
          break;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log('Error handling method', method, errorMsg);
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: errorMsg
        }
      });
    }
  });

  process.on('SIGINT', () => {
    log('Shutting down server.');
    process.exit(0);
  });
};
