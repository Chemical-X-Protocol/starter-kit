// Command schema entries for `scratch`, `worktree` and `mutate` (#6762, K17). Assembled in commands-schema.js after CI_COMMANDS.
export const WORKSPACE_COMMANDS = [
  {
    name: 'scratch',
    aliases: [],
    group: 'agents',
    brief: 'Your own scratch directory per agent',
    usage: 'chemx scratch [name] [--as=@handle]',
    summary: 'Print (and create when missing) .chemx/scratch/<handle>/, or the path of a file inside it.',
    description: 'Agents that share one scratchpad overwrite each other\'s one-off scripts; this gives each handle its own directory in the project: <project>/.chemx/scratch/<handle>/ (a linked worktree has its own). The handle is --as, then CHEMX_AGENT_ID, then the session handle, without the @. With no handle the directory is _shared and stderr says so. The directory is created on demand and git-ignored: a fresh repo gets .chemx/ in its .gitignore, and a .gitignore that lists only part of .chemx gets a .chemx/scratch/ line (git check-ignore decides, so a parent or global rule counts). With a name it prints the absolute path of that file inside the directory (folders in the name are made, the file is not; a name that leaves the directory is refused, exit 2). Exit 0 printed, 1 could not create it. `chemx mutate` keeps its originals here. See docs/agent-workspace.md.',
    flags: [{ flag: '--as=<@handle>', desc: 'Whose directory (default: CHEMX_AGENT_ID, else a session handle)' }],
    examples: ['chemx scratch', 'node "$(chemx scratch probe.mjs)"', 'chemx scratch out/run.log --as=@sonnet-k17']
  },
  {
    name: 'worktree',
    aliases: [],
    group: 'agents',
    brief: 'Add or remove a worktree, node_modules ready',
    usage: 'chemx worktree add <path> -b <branch> [--from <ref>] [--link-modules] [--install] | chemx worktree remove <path> [--force]',
    summary: 'Create a worktree on a new branch and give it node_modules; remove it and its merged branch.',
    description: 'add: git worktree add -b <branch> <path> <ref>, where --from <ref> defaults to the remote\'s default branch (origin/HEAD, else origin/main, origin/master, main, master). --link-modules gives the worktree a real node_modules directory whose entries (and scoped packages) are symlinks into the main checkout\'s node_modules, so a later install adds packages to the worktree without writing into the main checkout; --install runs the package manager the lockfile names (pnpm, yarn or npm) instead; both together link first, then install what is missing. Prints the path, the base commit and a one-line reminder that board commands (chemx team ...) run from the main checkout unless --board is passed. remove: git worktree remove, then deletes the worktree\'s local branch when it is merged into the default branch: an ancestor of it, or squash-merged (merging the branch into it would change nothing). A branch that is not merged, or a worktree with uncommitted files, is refused unless --force (git fetch first when the merge is recent). Never removes the main checkout or the directory you are standing in. Exit 0 done, 1 refused or git failed, 2 misused. See docs/agent-workspace.md.',
    flags: [
      { flag: '-b <branch>, --branch=<name>', desc: 'add: the new branch to create (required)' },
      { flag: '--from=<ref>', desc: 'add: what the branch starts from (default: the remote default branch)' },
      { flag: '--link-modules', desc: 'add: node_modules as a real directory of symlinks into the main checkout\'s' },
      { flag: '--install', desc: 'add: run the lockfile\'s package manager install in the worktree' },
      { flag: '--force', desc: 'remove: also remove a dirty worktree and delete an unmerged branch' }
    ],
    examples: ['chemx worktree add ../.worktrees/fix-a -b fix/a --link-modules', 'chemx worktree add ../.worktrees/fix-a -b fix/a --from origin/main --install', 'chemx worktree remove ../.worktrees/fix-a']
  },
  {
    name: 'mutate',
    aliases: [],
    group: 'agents',
    brief: 'Run a command on a temporarily changed file',
    usage: 'chemx mutate <file> --apply <patch-file|s/old/new/[g]> [--apply ...] --then "<command>" [--keep]',
    summary: 'Apply a temporary change to a file, run a command, and always put the original back byte for byte.',
    description: 'For mutation checks (does a spec fail when this line is wrong?). --apply is a unified-diff file for <file> (its header paths are ignored; hunks must match exactly, at most a few lines off), or a sed substitution `[N[,M]]s/pattern/replacement/[gi]` applied per line to the whole file or to lines N..M: pattern is a JavaScript regular expression, the replacement may use & and \\1..\\9, any non-alphanumeric character can delimit. A path that exists is read as a patch file first. --apply is repeatable and applied in order; a change that leaves the file as it was is refused (a check that mutates nothing proves nothing). --then is one shell command, run like `chemx run` (stdin, stdout and stderr are yours, your file leases renewed while it runs). The original is copied to .chemx/scratch/<handle>/mutate/ first, restored in every case (success, failure, a signal sent to chemx) and compared with the copy; the copy is deleted after a good restore unless --keep. Prints the command\'s exit code and exits with it; 125 means chemx itself could not go on (bad arguments, a patch that does not apply, a file another handle has leased, a restore that did not verify: the copy is kept and named). Not covered: a chemx process killed with SIGKILL cannot restore; the printed copy path is the way back. See docs/agent-workspace.md.',
    flags: [
      { flag: '--apply=<patch|sed>', desc: 'The change: a unified-diff file or a sed substitution (repeatable)' },
      { flag: '--then=<command>', desc: 'The command to run against the changed file (one shell command)' },
      { flag: '--keep', desc: 'Keep the copy of the original under the handle\'s scratch directory' },
      { flag: '--as=<@handle>', desc: 'Whose scratch directory and leases (default: CHEMX_AGENT_ID)' }
    ],
    examples: ['chemx mutate cli/gate.js --apply "s/>= 3/> 3/" --then "chemx test cli/gate.spec.js"', 'chemx mutate src/a.js --apply "12s/return x/return 0/" --apply broken-b.patch --then "node --test src/a.spec.js" --keep']
  }
];
