import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQL_FIXTURES } from '../fixtures/php/sql.fixtures.js';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { getProjectIndex, resetProjectIndexCache } from './wp-project-index.js';
import { wpSqlPass, wpSqlRegistration, RULE_DEFAULTS } from './wp-sql.js';

const RULE = 'SECURITY_WP_UNPREPARED_SQL';

function run(code, options = {}) {
  const ctx = buildPassContext(code, options);
  wpSqlPass(ctx);
  return ctx.records;
}

const inFn = (body) => `<?php\nfunction demo( $param ) {\n\tglobal $wpdb;\n${body}\n}\n`;
const inClass = (body) => `<?php\nclass Demo {\n${body}\n}\n`;

test('fixture pair: the bad file fires once at the sink line, the good one is silent', () => {
  const fixture = SQL_FIXTURES[RULE];
  const [hit, ...rest] = run(fixture.bad, { path: fixture.path, config: fixture.config });
  assert.equal(rest.length, 0);
  assert.equal(hit.rule, RULE);
  assert.equal(hit.line, 4);
  assert.equal(hit.severity, 'HIGH');
  assert.deepEqual(run(fixture.good, { path: fixture.path, config: fixture.config }), []);
});

test('severity: CRITICAL when the unsafe value is request-derived, HIGH otherwise', () => {
  const request = run(inFn('\t$id = $_GET["id"];\n\t$wpdb->query( "DELETE FROM t WHERE id = $id" );'));
  const other = run(inFn('\t$wpdb->query( "DELETE FROM t WHERE id = $param" );'));
  assert.equal(request[0].severity, 'CRITICAL');
  assert.equal(other[0].severity, 'HIGH');
});

test('the anchor is the sink call line, also for a multi-line query', () => {
  const hits = run(inFn('\t$x = 1;\n\t$wpdb->query(\n\t\t"DELETE FROM t WHERE id = $param"\n\t);'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 5);
});

test('only $wpdb, $this->wpdb and $this->db receivers are sinks', () => {
  assert.equal(run(inClass('\tfunction a( $p ) { $this->wpdb->query( "x $p" ); }\n\tfunction b( $p ) { $this->db->get_var( "x $p" ); }')).length, 2);
  assert.deepEqual(run(inFn('\t$other->query( "x $param" ); $this->cache->get_results( "x $param" );')), []);
});

test('safe values stay silent: literals, constants, numeric casts, $wpdb properties, escapers', () => {
  const body = [
    '\t$wpdb->query( "DELETE FROM {$wpdb->posts} WHERE ID = " . (int) $param );',
    '\t$wpdb->query( "DELETE FROM " . $wpdb->prefix . "demo WHERE ID = " . absint( $param ) );',
    '\t$wpdb->query( "CREATE TABLE x (id int) " . $wpdb->get_charset_collate() );',
    '\t$wpdb->get_var( "SELECT 1 WHERE a = \'" . esc_sql( $param ) . "\'" );',
    '\t$wpdb->get_row( "SELECT * FROM t WHERE u = " . get_current_user_id() . " LIMIT " . DEMO_LIMIT );',
  ].join('\n');
  assert.deepEqual(run(inFn(body)), []);
});

test('a prepared query is silent; call_user_func(_array) with [$wpdb, prepare] counts as prepare', () => {
  const body = [
    '\t$wpdb->get_results( $wpdb->prepare( "SELECT * FROM t WHERE a = %s", $param ) );',
    '\t$sql = "DELETE FROM t WHERE k IN (" . implode( ",", array_fill( 0, count( $param ), "%s" ) ) . ")";',
    '\t$query = call_user_func_array( array( $wpdb, "prepare" ), array_merge( array( $sql ), $param ) );',
    '\t$wpdb->query( $query );',
  ].join('\n');
  assert.deepEqual(run(inFn(body)), []);
});

test('implode over array_map of absint, intval or esc_sql is safe; over another callback it fires', () => {
  assert.deepEqual(run(inFn('\t$ids = implode( ",", array_map( "absint", $param ) );\n\t$wpdb->query( "DELETE FROM t WHERE id IN ($ids)" );')), []);
  assert.equal(run(inFn('\t$ids = implode( ",", array_map( "trim", $param ) );\n\t$wpdb->query( "DELETE FROM t WHERE id IN ($ids)" );')).length, 1);
});

test('an in_array allowlist ternary and a strict in_array guard make a value safe', () => {
  assert.deepEqual(run(inFn('\t$dir = in_array( $param, array( "ASC", "DESC" ) ) ? $param : "ASC";\n\t$wpdb->query( "SELECT 1 ORDER BY id $dir" );')), []);
  assert.deepEqual(run(inFn('\tif ( in_array( $param, array( "a", "b" ), true ) ) {\n\t\t$wpdb->query( "SELECT 1 ORDER BY $param" );\n\t}')), []);
  assert.deepEqual(run(inFn('\tif ( ! in_array( $param, array( "a", "b" ), true ) ) {\n\t\treturn;\n\t}\n\t$wpdb->query( "SELECT 1 ORDER BY $param" );')), []);
  assert.equal(run(inFn('\tif ( in_array( $param, array( "a", "b" ) ) ) {\n\t\t$wpdb->query( "SELECT 1 ORDER BY $param" );\n\t}')).length, 1);
});

test('variables resolve by their last plain assignment, with later appends', () => {
  assert.deepEqual(run(inFn('\t$sql = $_GET["x"];\n\t$sql = "SELECT 1";\n\t$wpdb->query( $sql );')), []);
  assert.equal(run(inFn('\t$sql = "SELECT 1";\n\t$sql .= $param;\n\t$wpdb->query( $sql );')).length, 1);
  assert.equal(run(inFn('\t$parts = array();\n\t$parts[] = $param;\n\t$wpdb->query( "SELECT " . implode( ",", $parts ) );')).length, 1);
});

test('values read back from the database through $wpdb count as safe', () => {
  const body = [
    '\t$names = $wpdb->get_col( "SHOW TABLES" );',
    '\tforeach ( $names as $name ) {',
    '\t\t$wpdb->query( "DROP TABLE `$name`" );',
    '\t}',
    '\t$rows = $wpdb->get_results( $wpdb->prepare( "SELECT t FROM x WHERE a = %s", $param ), ARRAY_N );',
    '\t$table = $rows[0][0];',
    '\t$wpdb->get_row( "SHOW CREATE TABLE `$table`" );',
  ].join('\n');
  assert.deepEqual(run(inFn(body)), []);
});

test('a helper method is classified by its returns, with call-site arguments bound', () => {
  const silent = inClass('\tfunction a( $p ) { global $wpdb; $wpdb->query( "DELETE FROM " . $this->name( "log" ) ); }\n\tfunction name( $suffix ) { return "demo_" . $suffix; }');
  assert.deepEqual(run(silent), []);
  const unsafe = inClass('\tfunction a( $p ) { global $wpdb; $wpdb->query( "DELETE FROM " . self::name( $p ) ); }\n\tstatic function name( $suffix ) { return "demo_" . $suffix; }');
  assert.equal(run(unsafe).length, 1);
  const returnsUnsafe = inClass('\tfunction a( $p ) { global $wpdb; $wpdb->query( $this->build( $p ) ); }\n\tfunction build( $v ) { return "SELECT * FROM t WHERE a = " . sanitize_text_field( $v ); }');
  assert.equal(run(returnsUnsafe).length, 1);
});

test('list() and [...] destructuring classify the right-hand call by position', () => {
  const body = (head) => inClass(`\tfunction a( $p ) { global $wpdb; ${head} = $this->pair( $p ); $wpdb->query( "UPDATE $table SET v = 1" ); }\n\tfunction pair( $p ) { global $wpdb; return array( $wpdb->prefix . "demo", sanitize_text_field( $p ) ); }`);
  assert.deepEqual(run(body('list( $table, $arg )')), []);
  assert.deepEqual(run(body('[ $table, $arg ]')), []);
  assert.equal(run(body('list( $arg, $table )')).length, 1);
});

test('a property with a literal default, written only from safe values, is safe', () => {
  const safe = inClass('\tprivate $col = "meta_value";\n\tfunction set() { $this->col = "meta_key"; }\n\tfunction a() { global $wpdb; $wpdb->query( "SELECT {$this->col} FROM t" ); }');
  assert.deepEqual(run(safe), []);
  const unsafe = inClass('\tprivate $col = "meta_value";\n\tfunction set( $c ) { $this->col = $c; }\n\tfunction a() { global $wpdb; $wpdb->query( "SELECT {$this->col} FROM t" ); }');
  assert.equal(run(unsafe).length, 1);
  assert.deepEqual(run(inClass('\tfunction a() { global $wpdb; $wpdb->query( "SELECT * FROM {$this->table_name}" ); }')), []);
});

test('parameters of a private or static helper are safe only when every call site passes a safe value', () => {
  const method = (extra) => inClass(`\tfunction run() { $this->drop( "a" ); ${extra} }\n\tprivate function drop( $t ) { global $wpdb; $wpdb->query( "DROP TABLE $t" ); }`);
  assert.deepEqual(run(method('')), []);
  assert.equal(run(method('$this->drop( $_GET["t"] );')).length, 1);
  assert.equal(run(inClass('\tpublic function drop( $t ) { global $wpdb; $wpdb->query( "DROP TABLE $t" ); }')).length, 1);
  assert.equal(run(inClass('\tprivate function drop( $t ) { global $wpdb; $wpdb->query( "DROP TABLE $t" ); }')).length, 1);
});

test('array_keys of a literal map, through array_filter and array_values, is safe', () => {
  const body = (map) => inClass(`\tstatic function map() { return ${map}; }\n\tfunction a( $present ) { global $wpdb; $formats = self::map(); $cols = array_values( array_filter( array_keys( $formats ), fn( $c ) => isset( $present[ $c ] ) ) ); $wpdb->query( "INSERT INTO t (" . implode( ",", $cols ) . ") VALUES (1)" ); }`);
  assert.deepEqual(run(body('array( "id" => "%d", "name" => "%s" )')), []);
  assert.equal(run(body('$_POST')).length, 1);
});

test('*table* helpers: a literal map is safe; an unresolvable X::*table*() is safe; the rest fire', () => {
  const mapped = inClass('\tprivate static $tables = array( "a" => "demo_a" );\n\tstatic function get_table_name( $n ) { return isset( self::$tables[ $n ] ) ? self::$tables[ $n ] : false; }\n\tfunction q( $n ) { global $wpdb; $t = self::get_table_name( $n ); $wpdb->get_results( "SELECT * FROM {$t}" ); }');
  assert.deepEqual(run(mapped), []);
  assert.deepEqual(run(inFn('\t$wpdb->get_results( "SELECT * FROM " . Other_Class::get_table_name( $param ) );')), []);
  assert.equal(run(inFn('\t$wpdb->get_results( "SELECT * FROM " . Other_Class::get_name( $param ) );')).length, 1);
});

test('prepare() whose query string interpolates an unsafe value fires; placeholders in arguments do not', () => {
  assert.equal(run(inFn('\t$wpdb->get_var( $wpdb->prepare( "SELECT a FROM t WHERE b = %s AND c = $param", 1 ) );')).length, 1);
  assert.deepEqual(run(inFn('\t$wpdb->get_var( $wpdb->prepare( "SELECT a FROM t WHERE b = %s", $param ) );')), []);
});

test('esc_like() without prepare fires with its own hazard text', () => {
  const [hit] = run(inFn('\t$wpdb->get_col( "SELECT id FROM t WHERE a LIKE \'%" . $wpdb->esc_like( $param ) . "%\'" );'));
  assert.equal(hit.rule, RULE);
  assert.match(hit.hazard, /esc_like\(\) escapes % and _ only/);
});

test('a LIKE wildcard around an unsafe value fires unless esc_like wraps the value', () => {
  assert.equal(run(inFn('\t$wpdb->get_col( $wpdb->prepare( "SELECT id FROM t WHERE a LIKE %s", "%" . $param . "%" ) );')).length, 1);
  assert.deepEqual(run(inFn('\t$wpdb->get_col( $wpdb->prepare( "SELECT id FROM t WHERE a LIKE %s", "%" . $wpdb->esc_like( $param ) . "%" ) );')), []);
  assert.deepEqual(run(inFn('\t$wpdb->get_col( $wpdb->prepare( "SELECT id FROM t WHERE a = %s", "%" . $param . "%" ) );')), []);
});

test('the project index resolves a helper and call sites in another file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wp-sql-'));
  try {
    fs.writeFileSync(path.join(root, 'tables.php'), '<?php\nclass Demo_Tables {\n\tpublic static function name( $n ) { global $wpdb; return $wpdb->prefix . "demo_" . $n; }\n\tpublic static function raw( $n ) { return $n; }\n}\n');
    const code = '<?php\nclass Demo {\n\tfunction a( $p ) { global $wpdb; $wpdb->query( "DELETE FROM " . Demo_Tables::name( "log" ) ); }\n\tfunction b( $p ) { global $wpdb; $wpdb->query( "DELETE FROM " . Demo_Tables::raw( $p ) ); }\n}\n';
    fs.writeFileSync(path.join(root, 'demo.php'), code);
    resetProjectIndexCache();
    const index = getProjectIndex(root, { overlay: { relativePath: 'demo.php', content: code } });
    const hits = run(code, { index });
    assert.deepEqual(hits.map((h) => h.line), [4]);
    assert.equal(run(code).length, 2, 'without an index neither helper resolves');
  } finally {
    resetProjectIndexCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('registration: WordPress-only pass for this rule, default-off with recorded figures', () => {
  assert.deepEqual(wpSqlRegistration.rules, [RULE]);
  assert.equal(wpSqlRegistration.isWordPress, true);
  assert.equal(wpSqlRegistration.run, wpSqlPass);
  assert.equal(typeof RULE_DEFAULTS[RULE].defaultOn, 'boolean');
});
