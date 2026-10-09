/**
 * Chemical X MCP sub-tool schemas: the swarm control panel in .chemx/index.db (status, feed,
 * post, task, lock) plus failure issue reporting. Assembled into SUB_TOOLS by manifests.js.
 */

export const TEAM_SUB_TOOLS = [
  {
    name: 'chemx_team_status',
    description: 'Query the multi-agent swarm control panel from .chemx/index.db (active agents, tasks breakdown, held file leases, FIFO lock waiters, and recent feed) in token-conserving columnar format.',
    inputSchema: {
      type: 'object',
      properties: {
        compact: { type: 'boolean', description: 'Return minimal token summary' }
      }
    }
  },
  {
    name: 'chemx_team_feed',
    description: 'Read the swarm activity feed and discussion threads from .chemx/index.db with token-efficient columnar formatting.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceId: { type: 'number', description: 'Fetch only events newer than this sequential ID' },
        threadId: { type: 'number', description: 'Filter events by parent discussion thread ID' },
        taskId: { type: 'number', description: 'Filter events by linked task ID' },
        agentId: { type: 'string', description: 'Filter events where agent is author, recipient, or public' },
        limit: { type: 'number', description: 'Maximum number of feed events to return (default: 50)' }
      }
    }
  },
  {
    name: 'chemx_team_post',
    description: 'Post an event, progress update, thread reply, or @mention message to the shared swarm activity feed in .chemx/index.db.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'Message or event description' },
        authorId: { type: 'string', description: 'Agent handle posting the event (e.g. "@coder-1")' },
        recipientId: { type: 'string', description: 'Optional target agent handle for direct pings/@mentions' },
        threadId: { type: 'number', description: 'Optional parent thread ID for replies' },
        taskId: { type: 'number', description: 'Optional linked task ID' },
        filePath: { type: 'string', description: 'Optional file path associated with the update' },
        eventType: { type: 'string', description: 'Event type (e.g. "broadcast", "mention", "progress", "blocker")' }
      }
    }
  },
  {
    name: 'chemx_team_task',
    description: 'Manage swarm tasks in .chemx/index.db (list, create, claim, complete, report blocker) with automatic AST health verification.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'claim', 'done', 'block'], description: 'Task action' },
        taskId: { type: 'number', description: 'Target task ID for claim, done, or block' },
        agentId: { type: 'string', description: 'Agent handle performing the action' },
        title: { type: 'string', description: 'Task title (for create)' },
        targetPath: { type: 'string', description: 'Target file path (for create)' },
        tier: { type: 'string', description: 'Component tier (for create)' },
        priority: { type: 'number', description: 'Priority weight 1-3 (for create)' },
        blockedReason: { type: 'string', description: 'Reason for blocker (for block)' },
        status: { type: 'string', description: 'Filter by status (for list)' }
      }
    }
  },
  {
    name: 'chemx_team_lock',
    description: 'Acquire or release a deterministic file lease in .chemx/index.db. If file is currently locked by another agent, enqueues into the zero-token FIFO lock queue.',
    inputSchema: {
      type: 'object',
      required: ['action', 'filePath', 'agentId'],
      properties: {
        action: { type: 'string', enum: ['acquire', 'release', 'status'], description: 'Lock action' },
        filePath: { type: 'string', description: 'Workspace relative file path to lock' },
        agentId: { type: 'string', description: 'Agent handle' },
        purpose: { type: 'string', description: 'Optional note explaining the lock purpose' },
        ttlMs: { type: 'number', description: 'Lock expiration TTL in milliseconds (default: 300000)' }
      }
    }
  },
  {
    name: 'chemx_report_issue',
    description: 'Catch script and build failures, format sanitized issue reports, generate one-click GitHub issue creation URLs, and optionally post directly to the repository GitHub Issues channel.',
    inputSchema: {
      type: 'object',
      required: ['error'],
      properties: {
        error: { type: 'string', description: 'Error message or description of the failure' },
        stack: { type: 'string', description: 'Optional stack trace' },
        command: { type: 'string', description: 'The command or script that failed (e.g. "pnpm run build")' },
        repo: { type: 'string', description: 'Target GitHub repository in "owner/repo" format (defaults to auto-detected git repository)' },
        autoPost: { type: 'boolean', description: 'Automatically publish the issue to GitHub Issues via API or gh CLI' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Issue labels (default: ["chemx-failure", "bug"])' },
        context: { type: 'object', description: 'Arbitrary context/metadata dictionary to attach to the issue report' }
      }
    }
  }
];
