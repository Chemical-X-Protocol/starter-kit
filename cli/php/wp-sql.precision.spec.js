import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { wpSqlPass, RULE_DEFAULTS } from './wp-sql.js';

// Design spec 8.3 for SECURITY_WP_UNPREPARED_SQL: one minimal snippet per labelled hit shape. `weight` is the
// number of labelled hits the case stands for. TP must fire; FP must stay silent unless `known: 'FP'` (a
// documented false positive). Labels judge the construct (a runtime value in SQL text that is not known to
// be safe), not exploitability. Measured 2026-10-24; the held-out hit labels are in the comments of #6479.
const RULE = 'SECURITY_WP_UNPREPARED_SQL';

const SALES = `class Sales {
	public static function getMonthlyReportSql( $settings ) {
		global $wpdb;
		$status_list = array();
		foreach ( (array) $settings['status'] as $st ) {
			$clean = preg_replace( '/^wc-/', '', trim( $st ) );
			$status_list[] = "wc-{$clean}";
		}
		$status_sql = "'" . implode( "','", array_unique( $status_list ) ) . "'";
		$sql = "SELECT * FROM {$wpdb->posts} WHERE post_status IN ({$status_sql})";
		return $sql;
	}
`;

const TABLES_RAW = `$tables_raw = $wpdb->get_results( $wpdb->prepare( "SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_name LIKE %s", DB_NAME, $wpdb->esc_like( $prefix ) . '%' ), ARRAY_N );`;

const wrap = (body) => `<?php\nfunction demo( $request, $prefix, $table, $body, $origin_prefix, $sql_file, $title, $sku ) {\n\tglobal $wpdb;\n${body}\n}\n`;

const CORPUS = [
  { label: 'TP', origin: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin-sales.php:257', weight: 1, code: `<?php\n${SALES}\tpublic function summary() {\n\t\tglobal $wpdb;\n\t\t$args = $_REQUEST;\n\t\t$monthly_sales = Sales::getMonthlyReportSql( $args );\n\t\t$sql = "SELECT sum(Gross) FROM ( {$monthly_sales} ) sales";\n\t\t$results = $wpdb->get_results( $sql );\n\t}\n}\n` },
  { label: 'TP', origin: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin-sales.php:305', weight: 1, code: `<?php\n${SALES}\tpublic function export() {\n\t\tglobal $wpdb;\n\t\t$args = $_REQUEST;\n\t\t$sql = Sales::getMonthlyReportSql( $args );\n\t\t$results = $wpdb->get_results( $sql );\n\t}\n}\n` },
  { label: 'TP', origin: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin.php:636', weight: 1, code: wrap(`\treturn $wpdb->get_col( "SELECT id FROM {$wpdb->posts} WHERE (post_title LIKE '%" . $wpdb->esc_like( $title ) . "%')" );`) },
  { label: 'TP', origin: 'xophz-compass-bazaar/admin/class-xophz-compass-bazaar-admin.php:644', weight: 1, code: wrap(`\treturn $wpdb->get_col( "SELECT post_id FROM {$wpdb->postmeta} WHERE (meta_key='_sku' AND meta_value LIKE '" . $wpdb->esc_like( $sku ) . "%')" );`) },
  { label: 'TP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-data.php:27', weight: 1, code: wrap(`\t$table = sanitize_text_field( $request->get_param( 'table' ) );\n\t$schema = $wpdb->get_row( "SHOW CREATE TABLE \`{$table}\`", ARRAY_A );`) },
  { label: 'TP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-data.php:36', weight: 1, code: wrap(`\t$table = sanitize_text_field( $request->get_param( 'table' ) );\n\t$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM \`{$table}\` LIMIT %d OFFSET %d", 1000, 0 ), ARRAY_A );`) },
  { label: 'TP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-import.php:142', weight: 1, code: wrap(`\t$local_table = $wpdb->prefix . substr( $table, strlen( $origin_prefix ) );\n\t$wpdb->query( "DROP TABLE IF EXISTS \`{$local_table}\`" );`) },
  { label: 'TP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-import.php:143', weight: 1, code: wrap(`\t$create_sql = $body['create_schema'];\n\t$create_sql = str_replace( "\`{$table}\`", "\`{$wpdb->prefix}x\`", $create_sql );\n\t$wpdb->query( $create_sql );`) },
  { label: 'FP', known: 'FP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-import.php:297 (SQL file import, by design)', weight: 1, code: wrap(`\t$handle = fopen( $sql_file, 'r' );\n\t$query = '';\n\twhile ( ( $line = fgets( $handle ) ) !== false ) {\n\t\t$query .= $line;\n\t\tif ( substr( rtrim( $query ), -1 ) === ';' ) {\n\t\t\t$wpdb->query( $query );\n\t\t\t$query = '';\n\t\t}\n\t}`) },
  { label: 'FP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-database-dump.php:97 and :107', weight: 2, code: wrap(`\t${TABLES_RAW}\n\t$tables_to_dump = array();\n\tforeach ( $tables_raw as $row ) {\n\t\t$tables_to_dump[] = $row[0];\n\t}\n\t$idx = 0;\n\twhile ( $idx < count( $tables_to_dump ) ) {\n\t\t$name = $tables_to_dump[ $idx ];\n\t\t$create = $wpdb->get_row( "SHOW CREATE TABLE \`{$name}\`", ARRAY_A );\n\t\t$rows = $wpdb->get_results( "SELECT * FROM \`{$name}\` LIMIT 1000", ARRAY_A );\n\t\t$idx++;\n\t}`) },
  { label: 'FP', origin: 'xophz-compass-moving-castle/includes/api-traits/trait-moving-castle-api-schema.php:55', weight: 1, code: wrap(`\t${TABLES_RAW}\n\tforeach ( $tables_raw as $row ) {\n\t\t$table_name = $row[0];\n\t\t$create_stmt = $wpdb->get_row( "SHOW CREATE TABLE \`{$table_name}\`", ARRAY_A );\n\t}`) },
];

// Card vault HEAD (c. 2026-10-24) shapes the earlier prototype flagged; none is a real defect.
const CATALOG = `<?php
class Catalog {
	public static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'card_vault_catalog';
	}
`;
const CARD_VAULT = [
  { label: 'FP', origin: 'class-card-vault-catalog-db.php:874-875 repair_empty_string_columns(string $table), called with self::get_table_name()', weight: 2, code: `${CATALOG}\tpublic static function migrate() {\n\t\t$table = self::get_table_name();\n\t\tself::repair_empty_string_columns( $table );\n\t}\n\tprivate static function repair_empty_string_columns( string $table ): void {\n\t\tglobal $wpdb;\n\t\t$wpdb->query( "UPDATE {$table} SET pricing_source = 'tcgcsv' WHERE pricing_source = '' AND psa10_price = 0" );\n\t\t$wpdb->query( "UPDATE {$table} SET upc = NULL WHERE upc = ''" );\n\t}\n}\n` },
  { label: 'FP', origin: 'class-card-vault-catalog-db.php:889-902 migrate_printing_key(string $table), called with self::get_table_name()', weight: 4, code: `${CATALOG}\tpublic static function migrate() {\n\t\t$table = self::get_table_name();\n\t\tself::migrate_printing_key( $table );\n\t}\n\tprivate static function migrate_printing_key( string $table ): void {\n\t\tglobal $wpdb;\n\t\t$indexes = $wpdb->get_results( "SHOW INDEX FROM {$table}", ARRAY_A );\n\t\t$key_names = array_unique( array_column( $indexes, 'Key_name' ) );\n\t\tif ( ! in_array( 'tcgplayer_printing', $key_names, true ) ) {\n\t\t\t$wpdb->query( "ALTER TABLE {$table} ADD UNIQUE KEY tcgplayer_printing (tcgplayer_id, sub_type_name)" );\n\t\t\t$indexes = $wpdb->get_results( "SHOW INDEX FROM {$table}", ARRAY_A );\n\t\t}\n\t\tif ( in_array( 'tcgplayer_id', $key_names, true ) ) {\n\t\t\t$wpdb->query( "ALTER TABLE {$table} DROP INDEX tcgplayer_id" );\n\t\t}\n\t}\n}\n` },
  { label: 'FP', origin: 'class-card-vault-catalog-db.php:678 batch_upsert_cards, array_keys($formats) column list', weight: 1, code: `${CATALOG}\tprivate static function upsert_column_formats() {\n\t\treturn array( 'id' => '%d', 'name' => '%s' );\n\t}\n\tpublic static function upsert( $chunk ) {\n\t\tglobal $wpdb;\n\t\t$table = self::get_table_name();\n\t\t$formats = self::upsert_column_formats();\n\t\t$present = array();\n\t\tforeach ( $chunk as $card ) {\n\t\t\tforeach ( $card as $col => $unused ) {\n\t\t\t\tif ( isset( $formats[ $col ] ) ) {\n\t\t\t\t\t$present[ $col ] = true;\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t\t$columns = array_values( array_filter( array_keys( $formats ), fn( $col ) => isset( $present[ $col ] ) ) );\n\t\t$placeholders = array();\n\t\t$values = array();\n\t\tforeach ( $chunk as $card ) {\n\t\t\t$row = array();\n\t\t\tforeach ( $columns as $col ) {\n\t\t\t\t$row[] = $formats[ $col ];\n\t\t\t\t$values[] = $card[ $col ];\n\t\t\t}\n\t\t\t$placeholders[] = '(' . implode( ', ', $row ) . ')';\n\t\t}\n\t\t$query = 'INSERT INTO ' . $table . ' (' . implode( ', ', $columns ) . ') VALUES ' . implode( ', ', $placeholders );\n\t\t$wpdb->query( empty( $values ) ? $query : $wpdb->prepare( $query, $values ) );\n\t}\n}\n` },
  { label: 'FP', origin: 'class-card-vault-catalog-db.php:856 ALTER TABLE ADD COLUMN over a literal column map', weight: 1, code: `${CATALOG}\tpublic static function add_columns() {\n\t\tglobal $wpdb;\n\t\t$table = self::get_table_name();\n\t\t$new_cols = array( 'psa9_price' => 'decimal(10,2) DEFAULT 0.00', 'pricing_source' => "varchar(50) DEFAULT 'tcgcsv'" );\n\t\tforeach ( $new_cols as $col_name => $col_def ) {\n\t\t\t$wpdb->query( "ALTER TABLE {$table} ADD COLUMN {$col_name} {$col_def}" );\n\t\t}\n\t}\n}\n` },
];

// Third-party held-out mechanisms that made the earlier prototype fire (forminator, hummingbird, wp-defender, hustle).
const MECHANISMS = [
  { label: 'FP', origin: 'forminator Forminator_Database_Tables::get_table_name(): a *table* helper reading a literal map', weight: 1, code: `<?php\nclass Forminator_Database_Tables {\n\tprivate static $tables = array();\n\tprivate static function table_names() {\n\t\tglobal $wpdb;\n\t\treturn array( 'form_entry' => $wpdb->prefix . 'frmt_form_entry' );\n\t}\n\tpublic static function get_table_name( $name ) {\n\t\tif ( empty( self::$tables ) ) {\n\t\t\tself::$tables = self::table_names();\n\t\t}\n\t\treturn isset( self::$tables[ $name ] ) ? self::$tables[ $name ] : false;\n\t}\n}\nclass Entry_Model {\n\tpublic function latest() {\n\t\tglobal $wpdb;\n\t\t$table_name = Forminator_Database_Tables::get_table_name( 'form_entry' );\n\t\treturn $wpdb->get_var( "SELECT entry_id FROM {$table_name} WHERE status = 'active'" );\n\t}\n}\n` },
  { label: 'FP', origin: 'wp-hummingbird thread-safe options: list($table, ...) = $this->get_table_columns()', weight: 1, code: `<?php\nclass Options {\n\tprivate function get_table_columns( $site_option ): array {\n\t\tglobal $wpdb;\n\t\t$table = $wpdb->options;\n\t\t$column = 'option_name';\n\t\tif ( $site_option && is_multisite() ) {\n\t\t\t$table = $wpdb->sitemeta;\n\t\t\t$column = 'meta_key';\n\t\t}\n\t\treturn array( $table, $column );\n\t}\n\tpublic function drop( $site_option ) {\n\t\tglobal $wpdb;\n\t\tlist( $table, $column ) = $this->get_table_columns( $site_option );\n\t\treturn $wpdb->query( "DELETE FROM {$table} WHERE {$column} LIKE 'x_%'" );\n\t}\n}\n` },
  { label: 'FP', origin: 'forminator analytics: a property with a literal default, written only from literals and constants', weight: 1, code: `<?php\nclass Analytics {\n\tprivate $time_window = 86400;\n\tpublic function __construct() {\n\t\t$this->time_window = HOUR_IN_SECONDS * 24;\n\t}\n\tpublic function prune() {\n\t\tglobal $wpdb;\n\t\t$time_window = $this->time_window;\n\t\treturn $wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_id < {$time_window}" );\n\t}\n}\n` },
  { label: 'FP', origin: 'wp-defender two-factor: call_user_func_array(array($wpdb, "prepare"), ...)', weight: 1, code: wrap(`\t$keys = array( 'a', 'b' );\n\t$sql = "DELETE FROM {$wpdb->usermeta} WHERE meta_key IN (" . implode( ',', array_fill( 0, count( $keys ), '%s' ) ) . ');';\n\t$query = call_user_func_array( array( $wpdb, 'prepare' ), array_merge( array( $sql ), $keys ) );\n\t$wpdb->query( $query );`) },
  { label: 'FP', origin: 'hustle: a value checked by a strict in_array in an if', weight: 1, code: wrap(`\t$order = isset( $request['order'] ) ? $request['order'] : 'DESC';\n\tif ( in_array( $order, array( 'ASC', 'DESC' ), true ) ) {\n\t\t$wpdb->query( "SELECT id FROM {$wpdb->posts} ORDER BY id {$order}" );\n\t}`) },
];

// Held-out shapes that fire and are true at the construct level (wp-hummingbird, wp-smush-pro, hustle, forminator).
const HELD_OUT_TRUE = [
  { label: 'TP', origin: 'wp-hummingbird thread-safe options: $option_id and $key interpolated into UPDATE', weight: 1, code: wrap(`\t$wpdb->query( "UPDATE {$wpdb->options} SET option_value = JSON_REMOVE(option_value, '$.\\"$title\\"') WHERE option_name = '$sku'" );`) },
  { label: 'TP', origin: 'hustle hustle-model.php:1356: LIKE wildcard around a role slug without esc_like', weight: 1, code: wrap(`\t$wpdb->get_var( $wpdb->prepare( "SELECT module_id FROM {$wpdb->postmeta} WHERE meta_value LIKE %s LIMIT 1", '%"' . $title . '"%' ) );`) },
  { label: 'TP', origin: 'forminator class-form-entry-model.php:2303: an $order parameter in the query string given to prepare()', weight: 1, code: wrap(`\t$sql = "SELECT entry_id FROM {$wpdb->posts} WHERE form_id = %d ORDER BY date_created {$title}";\n\t$wpdb->get_var( $wpdb->prepare( $sql, 1 ) );`) },
];

function fired(code) {
  const ctx = buildPassContext(code);
  wpSqlPass(ctx);
  return ctx.records.map((record) => record.rule);
}

function detected(item) {
  return fired(item.code).includes(RULE);
}

function weightedPrecision(items) {
  let truePositive = 0;
  let falsePositive = 0;
  for (const item of items.filter(detected)) {
    const isTp = item.label === 'TP';
    truePositive += isTp ? item.weight : 0;
    falsePositive += isTp ? 0 : item.weight;
  }
  const reported = truePositive + falsePositive;
  return reported === 0 ? 1 : truePositive / reported;
}

test('u2 corpus: every TP fires, every FP stays silent except the documented known FP', () => {
  for (const item of CORPUS) {
    const expected = item.label === 'TP' || item.known === 'FP';
    assert.equal(detected(item), expected, `${item.label} ${item.origin}`);
  }
});

test('u2 corpus: weights sum to the 12 labelled hits, precision at least 80%', () => {
  assert.equal(CORPUS.reduce((sum, item) => sum + item.weight, 0), 12);
  const silent = CORPUS.filter((item) => item.label === 'FP' && !item.known).reduce((sum, item) => sum + item.weight, 0);
  assert.equal(silent, 3, 'the 3 database-read false positives are silent');
  const precision = weightedPrecision(CORPUS);
  assert.ok(precision >= 0.8, `precision ${precision}`);
  assert.equal(precision, 8 / 9);
});

test('card vault HEAD: the 8 shapes the prototype flagged are silent', () => {
  assert.equal(CARD_VAULT.reduce((sum, item) => sum + item.weight, 0), 8);
  for (const item of CARD_VAULT) assert.equal(detected(item), false, item.origin);
});

test('held-out mechanisms: the 5 third-party shapes that made the prototype fire are silent', () => {
  for (const item of MECHANISMS) assert.equal(detected(item), false, item.origin);
});

test('held-out true shapes still fire', () => {
  for (const item of HELD_OUT_TRUE) assert.equal(detected(item), true, item.origin);
});

test('the shipped default is off: held-out precision (19 of 70 labelled hits) is under the 80% bar', () => {
  assert.equal(RULE_DEFAULTS[RULE].defaultOn, false);
  assert.equal(RULE_DEFAULTS[RULE].corpus, '8/9');
  assert.equal(RULE_DEFAULTS[RULE].heldOut, '19/70');
});
