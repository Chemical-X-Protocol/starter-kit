// Fixtures for SECURITY_WP_PUBLIC_REGISTRATION_ROUTE (task #6709). Strings, never .php files; names are generic.
// REGISTRATION_SHAPES must report; REGISTRATION_SILENT must not.
export const REGISTRATION_PATH = 'wp-content/plugins/demo/demo.php';

const HEADER = `<?php
/**
 * Plugin Name: Demo
 */
`;

const route = (path, methods, permission, callback) => `	register_rest_route( 'demo/v1', '${path}', array(
		'methods'             => '${methods}',
		'callback'            => ${callback},
		'permission_callback' => ${permission},
	) );`;

const file = (registration, rest) => `${HEADER}add_action( 'rest_api_init', 'demo_register_routes' );
function demo_register_routes() {
${registration}
}
${rest}`;

const CREATE = `function demo_signup( $request ) {
	$id = wp_create_user( $request['name'], $request['pass'], $request['email'] );
	return rest_ensure_response( array( 'id' => $id ) );
}
`;

export const REGISTRATION_SHAPES = {
  captchaOnly: file(route('/auth/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	if ( ! demo_verify_turnstile_token( $request['token'] ) ) {
		return new WP_Error( 'captcha', 'Captcha failed' );
	}
	$id = wp_create_user( $request['name'], $request['pass'], $request['email'] );
	return rest_ensure_response( array( 'id' => $id ) );
}
function demo_verify_turnstile_token( $token ) {
	return ! empty( $token );
}
`),
  insertUser: file(route('/signup', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	return wp_insert_user( array( 'user_login' => $request['name'], 'user_pass' => $request['pass'] ) );
}
`),
  twoHopsDown: file(route('/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	return demo_make( $request );
}
function demo_make( $request ) {
	return demo_store( $request );
}
function demo_store( $request ) {
	return wp_create_user( $request['name'], $request['pass'] );
}
`),
  createUserRoute: file(route('/contacts/(?P<id>\\d+)/create-user', 'POST', "'__return_true'", "'demo_signup'"), CREATE),
};

export const REGISTRATION_SILENT = {
  readsSetting: file(route('/auth/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	if ( ! get_option( 'users_can_register' ) ) {
		return new WP_Error( 'closed', 'Registration is closed' );
	}
	if ( ! wp_verify_nonce( $request['nonce'], 'demo_register' ) ) {
		return new WP_Error( 'nonce', 'Bad nonce' );
	}
	return wp_create_user( $request['name'], $request['pass'], $request['email'] );
}
`),
  settingTwoHopsDown: file(route('/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	return demo_make( $request );
}
function demo_make( $request ) {
	if ( ! demo_registration_open() ) {
		return new WP_Error( 'closed', 'Closed' );
	}
	return wp_create_user( $request['name'], $request['pass'] );
}
function demo_registration_open() {
	return (bool) get_option( 'users_can_register' );
}
`),
  pluginSetting: file(route('/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	if ( ! get_option( 'demo_allow_registration' ) ) {
		return new WP_Error( 'closed', 'Closed' );
	}
	return wp_create_user( $request['name'], $request['pass'] );
}
`),
  permissionChecksUser: file(route('/register', 'POST', "'demo_can'", "'demo_signup'"), `function demo_can() {
	return current_user_can( 'create_users' );
}
${CREATE}`),
  readVerb: file(route('/register', 'GET', "'__return_true'", "'demo_signup'"), CREATE),
  passwordlessLogin: file(route('/auth/request-code', 'POST', "'__return_true'", "'demo_signup'"), CREATE),
  oauthCallback: file(route('/discord/token', 'POST', "'__return_true'", "'demo_signup'"), CREATE),
  webhook: file(route('/stripe/webhook', 'POST', "'__return_true'", "'demo_signup'"), CREATE),
  noUserCreated: file(route('/register', 'POST', "'__return_true'", "'demo_signup'"), `function demo_signup( $request ) {
	update_option( 'demo_waitlist', sanitize_email( $request['email'] ) );
}
`),
};

export const REGISTRATION_FIXTURES = {
  SECURITY_WP_PUBLIC_REGISTRATION_ROUTE: {
    path: REGISTRATION_PATH,
    config: { rules: { SECURITY_WP_PUBLIC_REGISTRATION_ROUTE: 'on' }, overrides: [], wordpress: true },
    bad: REGISTRATION_SHAPES.captchaOnly,
    good: REGISTRATION_SILENT.readsSetting,
  },
};
