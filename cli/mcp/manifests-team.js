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
        compact: { type: 'boolean', description: 'Return minimal token summary' },
        blockers: { type: 'boolean', description: 'Also list the blocked tasks (default: only the blocked count)' },
        mine: { type: 'boolean', description: 'Scope to agentId (default: the caller): its open tasks, leases and own events' },
        agentId: { type: 'string', description: 'Agent handle for mine (default: the caller)' }
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
        from: { type: 'string', description: 'Only events authored by this agent handle' },
        type: { type: 'string', description: 'lock, task, status or post (a group), or an exact event type; comma-separated for several' },
        full: { type: 'boolean', description: 'Return whole messages (default: each message cut to 120 characters on one line)' },
        limit: { type: 'number', description: 'Maximum number of feed events to return (default: 20, newest)' }
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
        action: { type: 'string', enum: ['list', 'show', 'create', 'comment', 'claim', 'handoff', 'done', 'block', 'brief'], description: 'Task action. create and comment return ids and a one-line ack, not the text sent. brief reads, sets or clears the long brief of a task' },
        taskId: { type: 'number', description: 'Target task ID for show, comment, claim, handoff, done, block or brief' },
        to: { type: 'string', description: 'Agent handle taking the task over (for handoff; agentId is who hands off)' },
        withLocks: { type: 'boolean', description: 'Also move the live leases whose purpose names the task (for handoff)' },
        brief: { type: 'boolean', description: 'show: title, status, tier, assignee, dependencies, parent and only the comments after the description (no description)' },
        full: { type: 'boolean', description: 'show: also return the long brief text (default: only its length, briefChars)' },
        search: { type: 'string', description: 'list: only tasks whose title or description contains this text (any case); looks in every status unless status is given' },
        titles: { type: 'boolean', description: 'list: only id, status and the whole title per task' },
        kind: { type: 'string', enum: ['task', 'decision', 'epic'], description: 'Kind of task (for create; default task). A decision or epic needs no target file to be completed' },
        description: { type: 'string', description: 'Short description (for create)' },
        briefText: { type: 'string', description: 'The long brief text (for create, or brief to set it)' },
        briefFile: { type: 'string', description: 'Path of a file holding the long brief, relative to the project root (for create, or brief to set it); cheaper than sending the text' },
        clear: { type: 'boolean', description: 'brief: remove the task\'s brief' },
        fromFile: { type: 'string', description: 'create: a .json or .yaml file of task rows (ref, title, needs, prio, kind, parent, parent_ref, deps, desc, brief, brief_file), all added in one transaction; returns the added tasks and a ref -> id map' },
        dryRun: { type: 'boolean', description: 'create with fromFile: check the file and return what would be added, write nothing' },
        message: { type: 'string', description: 'Comment text (for comment)' },
        agentId: { type: 'string', description: 'Agent handle performing the action' },
        title: { type: 'string', description: 'Task title (for create)' },
        targetPath: { type: 'string', description: 'Target file path (for create)' },
        tier: { type: 'string', description: 'Component tier (for create)' },
        priority: { type: 'number', description: 'Priority weight 1-3 (for create)' },
        blockedReason: { type: 'string', description: 'Reason for blocker (for block)' },
        status: { type: 'string', description: 'list: filter by status. update: queued, in_progress, review, blocked, done or cancelled (anything else is refused; none means in_progress)' },
        needs: { type: 'string', enum: ['light', 'standard', 'deep'], description: 'Minimum capability tier the task needs (for create; filter for list)' }
      }
    }
  },
  {
    name: 'chemx_team_lock',
    description: 'Acquire or release a file lease in .chemx/index.db. If another agent holds a live lease on the file, you are queued FIFO. A lease lasts 5 minutes and any chemx call by the holder extends it; see docs/team-locks.md.',
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
