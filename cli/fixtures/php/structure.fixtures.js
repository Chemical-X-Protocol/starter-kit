// PHP fixture pairs for the structural rule family (design spec 8.1): { path, bad, good }.
// Snippets are generic (demo_ names), never real project code. Not shipped to npm.

const CONFIG = { rules: {}, overrides: [], wordpress: true };
// The cascade and silent guard rules are off for PHP until a setting names them (RULE_DEFAULTS in
// cli/php/php-control-flow.js), so their fixtures switch them on.
const configOn = (rule) => ({ ...CONFIG, rules: { [rule]: 'on' } });
const CLASS_PATH = 'includes/class-demo.php';

const repeat = (count, make) => Array.from({ length: count }, (_, i) => make(i)).join('\n');

const branchyFunction = (branches) => `<?php
function demo_score( $value ) {
	$total = 0;
${repeat(branches, (i) => `	if ( $value === ${i} ) {\n		$total += ${i};\n	}`)}
	return $total;
}
`;

const partialRows = (rows) => `<?php defined( 'ABSPATH' ) || exit; ?>
<section class="demo-display">
${repeat(rows, (i) => `	<p><?php echo esc_html( $demo_row_${i} ); ?></p>`)}
</section>
`;

export const PHP_STRUCTURE_FIXTURES = {
  COMPLEXITY_CYCLOMATIC_HIGH: {
    path: CLASS_PATH,
    config: CONFIG,
    bad: branchyFunction(12),
    good: branchyFunction(11),
  },
  STRUCTURAL_WEIGHT_EXCEEDED: {
    path: CLASS_PATH,
    config: CONFIG,
    bad: `<?php
function demo_walk( $groups ) {
	foreach ( $groups as $group ) {
		if ( $group->is_open ) {
			foreach ( $group->rows as $row ) {
				if ( $row->is_ready ) {
					demo_emit( $row );
				}
			}
		}
	}
}
`,
    good: `<?php
function demo_walk( $groups ) {
	foreach ( $groups as $group ) {
		if ( $group->is_open ) {
			demo_walk_rows( $group->rows );
		}
	}
}
function demo_walk_rows( $rows ) {
	foreach ( $rows as $row ) {
		if ( $row->is_ready ) {
			demo_emit( $row );
		}
	}
}
`,
  },
  CONTROL_FLOW_NESTED_TERNARY: {
    path: CLASS_PATH,
    config: CONFIG,
    bad: `<?php
function demo_label( $a, $b ) {
	return $a ? 'first' : ( $b ? 'second' : 'third' );
}
`,
    good: `<?php
function demo_label( $a, $b ) {
	$fallback = $b ?: 'third';
	return $a ? 'first' : $fallback;
}
function demo_pick( $a, $b, $c ) {
	return $a ?: ( $b ?: $c );
}
`,
  },
  CONTROL_FLOW_CASCADE_GUARDS: {
    path: CLASS_PATH,
    config: configOn('CONTROL_FLOW_CASCADE_GUARDS'),
    bad: `<?php
function demo_run( $post_id ) {
	if ( ! isset( $_POST['demo_nonce'] ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	demo_store( $post_id );
}
`,
    good: `<?php
function demo_run( $post_id ) {
	if ( ! demo_may_run( $post_id ) ) {
		return;
	}
	demo_store( $post_id );
}
function demo_load( $post_id ) {
	$post = get_post( $post_id );
	if ( ! $post ) {
		return;
	}
	$owner = get_userdata( $post->post_author );
	if ( ! $owner ) {
		return;
	}
	$email = $owner->user_email;
	if ( empty( $email ) ) {
		return;
	}
	demo_store( $email );
}
`,
  },
  CONTROL_FLOW_SILENT_GUARD: {
    path: CLASS_PATH,
    config: configOn('CONTROL_FLOW_SILENT_GUARD'),
    bad: `<?php
function save_demo( $result ) {
	if ( is_wp_error( $result ) ) {
		return;
	}
	update_option( 'demo_saved', 1 );
}
`,
    good: `<?php
function save_demo( $result ) {
	if ( is_wp_error( $result ) ) {
		error_log( 'demo save failed' );
		return;
	}
	update_option( 'demo_saved', 1 );
}
`,
  },
  VIEW_MONOLITH: {
    path: 'admin/partials/demo-display.php',
    config: CONFIG,
    bad: partialRows(207),
    good: partialRows(3),
  },
  LINE_BUDGET_FILE: {
    path: 'includes/demo-codes.php',
    config: CONFIG,
    bad: `<?php\n${repeat(500, (i) => `define( 'DEMO_CODE_${i}', ${i} );`)}\n`,
    good: `<?php\n${repeat(499, (i) => `define( 'DEMO_CODE_${i}', ${i} );`)}\n`,
  },
  SYNTAX_PARSE_ERROR: {
    path: CLASS_PATH,
    config: CONFIG,
    bad: `<?php
function demo_label( $a {
	return $a;
}
`,
    good: `<?php
function demo_label( $a ) {
	return $a;
}
`,
  },
};
