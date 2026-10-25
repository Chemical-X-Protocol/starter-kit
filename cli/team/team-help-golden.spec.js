// The team help text (the three cards and the `team` schema entry) is assembled from the per-subcommand
// modules in cli/team/help/. This spec pins the assembled output byte for byte, colours included, so a
// split or a reorder of those modules cannot change what `chemx team --help`, `chemx team task --help`,
// `chemx team lock --help` and `chemx help team` print (#6767).
// A deliberate help change: run `UPDATE_GOLDEN=1 chemx test cli/team/team-help-golden.spec.js` and commit the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTeamHelpCard, formatTaskHelpCard, formatLockHelpCard } from './team-format.js';
import { findCommandSchema } from '../commands-schema.js';
import { formatCommandHelp } from '../help.js';

const GOLDEN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'team-help-golden.json');
const teamSchema = () => findCommandSchema('team');

const assembledHelp = () => ({
  teamCard: formatTeamHelpCard().split('\n'),
  taskCard: formatTaskHelpCard().split('\n'),
  lockCard: formatLockHelpCard().split('\n'),
  teamSchema: teamSchema(),
  teamCommandHelp: formatCommandHelp(teamSchema()).split('\n')
});

const refreshGolden = () => {
  fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(assembledHelp(), null, 2)}\n`);
};

const REFRESH_HINT = 'A deliberate help change: UPDATE_GOLDEN=1 chemx test cli/team/team-help-golden.spec.js, then commit cli/team/team-help-golden.json.';

test('the golden fixture is refreshed on request', (t) => {
  const isRefreshing = process.env.UPDATE_GOLDEN === '1';
  if (!isRefreshing) return t.skip('set UPDATE_GOLDEN=1 to rewrite cli/team/team-help-golden.json');
  refreshGolden();
  assert.ok(fs.existsSync(GOLDEN_FILE));
});

for (const part of ['teamCard', 'taskCard', 'lockCard', 'teamSchema', 'teamCommandHelp']) {
  test(`${part} is byte for byte what the golden fixture holds`, () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
    assert.deepStrictEqual(assembledHelp()[part], golden[part], REFRESH_HINT);
  });
}
