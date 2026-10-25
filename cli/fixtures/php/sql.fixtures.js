// Fixture pair for SECURITY_WP_UNPREPARED_SQL (design spec 8.1). Not shipped to npm. The rule ships default-off
// (see RULE_DEFAULTS in cli/php/wp-sql.js), so the config switches it on.
const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: { SECURITY_WP_UNPREPARED_SQL: 'on' }, overrides: [], wordpress: true };

export const SQL_FIXTURES = {
  SECURITY_WP_UNPREPARED_SQL: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_find( $title ) {
	global $wpdb;
	return $wpdb->get_results( "SELECT ID FROM {$wpdb->posts} WHERE post_title = '{$title}'" );
}
`,
    good: `<?php
function demo_find( $title ) {
	global $wpdb;
	return $wpdb->get_results( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_title = %s", $title ) );
}
`,
  },
};
