// Fixture pairs for the PHP dangerous-function rules (design spec 8.1). Not shipped to npm.
const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: {}, overrides: [], wordpress: true };

export const DANGEROUS_FIXTURES = {
  SECURITY_DYNAMIC_CODE_EXECUTION: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_run( $code ) {
	eval( $code );
}
`,
    good: `<?php
function demo_run( $name ) {
	$handlers = array( 'first' => 'demo_first', 'second' => 'demo_second' );
	assert( $name !== '' );
	if ( isset( $handlers[ $name ] ) ) {
		return call_user_func( $handlers[ $name ] );
	}
	return null;
}
`,
  },
  SECURITY_PHP_OBJECT_INJECTION: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_load() {
	$raw = wp_unslash( $_POST['payload'] );
	return maybe_unserialize( $raw );
}
`,
    good: `<?php
function demo_load( $stored ) {
	$meta = maybe_unserialize( $stored );
	$data = unserialize( $stored, array( 'allowed_classes' => false ) );
	return array( $meta, $data );
}
`,
  },
  SECURITY_PHP_COMMAND_EXECUTION: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_list( $dir ) {
	return shell_exec( 'ls ' . escapeshellarg( $dir ) );
}
`,
    good: `<?php
function demo_list( $dir ) {
	return scandir( $dir );
}
`,
  },
};
