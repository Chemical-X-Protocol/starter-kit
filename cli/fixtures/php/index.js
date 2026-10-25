// PHP fixture pairs for rule-fixtures.spec.js (design spec 8.1): the rule-family modules merged into
// PHP_FIXTURES = { RULE_ID: { path, config, bad, good } }. Not shipped to npm. A rule id appears in
// exactly one family; rule-fixtures.spec.js checks that no family overrides another.
import { PHP_STRUCTURE_FIXTURES } from './structure.fixtures.js';
import { CATCH_FIXTURES } from './catch.fixtures.js';
import { DANGEROUS_FIXTURES } from './dangerous.fixtures.js';
import { ROUTES_FIXTURES } from './routes.fixtures.js';
import { NONCE_FIXTURES } from './nonce.fixtures.js';
import { SQL_FIXTURES } from './sql.fixtures.js';
import { REQUEST_FLOW_FIXTURES } from './request-flow.fixtures.js';
import { AUTH_FILTER_FIXTURES } from './auth-filters.fixtures.js';
import { REGISTRATION_FIXTURES } from './registration.fixtures.js';
import { SHADOW_FIXTURES } from './shadow.fixtures.js';
import { BOUNDS_FIXTURES } from './bounds.fixtures.js';

/** [familyName, fixtures] in merge order. */
export const PHP_FIXTURE_FAMILIES = Object.freeze([
  ['structure', PHP_STRUCTURE_FIXTURES],
  ['catch', CATCH_FIXTURES],
  ['dangerous', DANGEROUS_FIXTURES],
  ['routes', ROUTES_FIXTURES],
  ['nonce', NONCE_FIXTURES],
  ['sql', SQL_FIXTURES],
  ['request-flow', REQUEST_FLOW_FIXTURES],
  ['auth-filters', AUTH_FILTER_FIXTURES],
  ['registration', REGISTRATION_FIXTURES],
  ['shadow', SHADOW_FIXTURES],
  ['bounds', BOUNDS_FIXTURES],
]);

export const PHP_FIXTURES = Object.freeze(Object.assign({}, ...PHP_FIXTURE_FAMILIES.map(([, fixtures]) => fixtures)));
