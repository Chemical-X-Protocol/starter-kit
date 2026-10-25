// The Commands rows of the `chemx team --help` card, in the order they print. Each subcommand's rows live in its own
// module; a new subcommand adds its module and one entry here.
import * as status from './status.js';
import * as task from './task.js';
import * as brief from './brief.js';
import * as lock from './lock.js';
import * as unlock from './unlock.js';
import * as feed from './feed.js';
import * as post from './post.js';
import * as inbox from './inbox.js';
import * as dm from './dm.js';
import * as tokens from './tokens.js';
import * as route from './route.js';
import * as triage from './triage.js';
import * as benchmark from './benchmark.js';
import * as train from './train.js';

const SUBCOMMANDS_IN_CARD_ORDER = [status, task, brief, lock, unlock, feed, post, inbox, dm, tokens, route, triage, benchmark, train];

export const TEAM_CARD_ROWS = SUBCOMMANDS_IN_CARD_ORDER.flatMap((subcommand) => subcommand.teamCardRows);
