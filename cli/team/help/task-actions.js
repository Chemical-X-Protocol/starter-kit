// Help text of `chemx team task <action>`: the Actions rows of the `chemx team task --help` card, in the order they print.
// A new action adds its row here.

export const taskCardActions = [
  '    \x1b[32mlist\x1b[0m                         List open tasks, newest 20 (default action)',
  '    \x1b[32mshow\x1b[0m <taskId> [--brief]     Display full details and activity stream for a task (creation event on one line)',
  '    \x1b[32madd\x1b[0m "<title>"                Create a new task in the queue; prints "#<id> added: <title>"',
  '    \x1b[32mclaim\x1b[0m <taskId>              Claim an unassigned task for an agent',
  '    \x1b[32mhandoff\x1b[0m <taskId> <@to>      Pass a task to another agent (assignee or creator only); --with-locks also moves your live leases naming the task',
  '    \x1b[32mdone\x1b[0m <taskId>               Complete a task with automatic verification audit',
  '    \x1b[32mclose\x1b[0m <taskId>              End a task that will not be completed: --duplicate-of=<id> or --cancel=<reason>',
  '    \x1b[32mupdate\x1b[0m <taskId> [status]    Update task status: queued, in_progress, review, blocked, done or cancelled (anything else is refused)',
  '    \x1b[32mcomment\x1b[0m <taskId> <msg>       Post a comment or status update; prints "#<id>: comment N posted" (N = feed event id)',
  '    \x1b[32mtriage\x1b[0m                    Generate tasks from AST architectural hazards',
  '    \x1b[32mreconcile\x1b[0m                 Auto-resolve tasks whose hazards have been fixed',
  '    \x1b[32mset-target\x1b[0m <id> <path>     Assign target file path to a task',
  '    \x1b[32mset-files\x1b[0m <id> [<file...>] Set extra files for a task (no files clears the list)',
  '    \x1b[32mvds-slot\x1b[0m <id> <moscow> <p> Set MoSCoW slot and priority on a task',
  '    \x1b[32mtrace\x1b[0m <id> <url>            Attach provenance trace URL to a task'
];
