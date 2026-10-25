// Fixtures for SECURITY_WP_AUTH_ERROR_CLEARED (task #6708). Strings, never .php files; names are generic.
// AUTH_FILTER_SHAPES are the callback forms the pass resolves; each bad source must report, each good source must not.
export const AUTH_FILTER_PATH = 'wp-content/plugins/demo/demo.php';

const HEADER = `<?php
if ( ! defined( 'WPINC' ) ) {
	die;
}
`;

const clearsNonce = (value) => `
	if ( is_wp_error( $error ) && 'rest_cookie_invalid_nonce' === $error->get_error_code() ) {
		return ${value};
	}
	return $error;`;

export const AUTH_FILTER_SHAPES = {
  methodNull: `${HEADER}class Demo_Api {
	public function __construct() {
		add_filter( 'rest_authentication_errors', array( $this, 'demo_bypass' ), 999 );
	}
	public function demo_bypass( $error ) {${clearsNonce('null')}
	}
}
`,
  closureTrue: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {${clearsNonce('true')}
}, 101 );
`,
  functionName: `${HEADER}add_filter( 'rest_authentication_errors', 'demo_bypass' );
function demo_bypass( $error ) {${clearsNonce('null')}
}
`,
  shortArrayStatic: `${HEADER}class Demo_Api {
	public static function boot() {
		add_filter( 'rest_authentication_errors', [ self::class, 'demo_bypass' ] );
	}
	public static function demo_bypass( $error ) {${clearsNonce('null')}
	}
}
`,
  arrowNull: `${HEADER}add_filter( 'rest_authentication_errors', fn( $error ) => null );
`,
  pathOnlyNull: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {
	if ( false !== strpos( $_SERVER['REQUEST_URI'], '/demo/v1/login' ) ) {
		return null;
	}
	return $error;
} );
`,
};

export const AUTH_FILTER_SILENT = {
  passesErrorThrough: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {
	return $error;
} );
`,
  returnsOwnError: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'demo_forbidden', 'Login required.', array( 'status' => 401 ) );
	}
	return $error;
} );
`,
  checksCredential: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {
	$key = isset( $_SERVER['HTTP_X_DEMO_KEY'] ) ? $_SERVER['HTTP_X_DEMO_KEY'] : '';
	if ( hash_equals( get_option( 'demo_key' ), $key ) ) {
		return true;
	}
	return $error;
} );
`,
  otherHook: `${HEADER}add_filter( 'demo_filter', function ( $value ) {
	return null;
} );
`,
  nestedClosureOnly: `${HEADER}add_filter( 'rest_authentication_errors', function ( $error ) {
	$unused = function () {
		return null;
	};
	return $error;
} );
`,
  nullOnlyWhenNotError: `${HEADER}add_filter( 'rest_authentication_errors', function ( $e ) {
	if ( ! is_wp_error( $e ) ) {
		return null;
	}
	return $e;
} );
`,
  callbackInOtherClass: `${HEADER}add_filter( 'rest_authentication_errors', array( 'Demo_Elsewhere', 'demo_bypass' ) );
`,
};

export const AUTH_FILTER_FIXTURES = {
  SECURITY_WP_AUTH_ERROR_CLEARED: {
    path: AUTH_FILTER_PATH,
    config: { rules: { SECURITY_WP_AUTH_ERROR_CLEARED: 'on' }, overrides: [], wordpress: true },
    bad: AUTH_FILTER_SHAPES.methodNull,
    good: AUTH_FILTER_SILENT.returnsOwnError,
  },
};
