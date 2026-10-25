// Fixtures for SECURITY_WP_SHADOWED_ROUTE (task #6711). Strings, never .php files; names are generic.
import { HEADER } from './routes.fixtures.js';

const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: { SECURITY_WP_SHADOWED_ROUTE: 'on' }, overrides: [], wordpress: true };
const ITEM = '/items/(?P<id>[a-z0-9-]+)';

const route = (path, methods, ns = "'demo/v1'") => `	register_rest_route( ${ns}, '${path}', array(
		'methods'             => ${methods},
		'callback'            => 'demo_cb',
		'permission_callback' => 'demo_can',
	) );
`;

/** One demo.php registering the given route strings in order, inside one function. */
export const shadowFile = (body, head = '') => `${HEADER}${head}add_action( 'rest_api_init', 'demo_register_routes' );
function demo_register_routes() {
${body}}
function demo_cb() { return 1; }
function demo_can() { return current_user_can( 'read' ); }
`;

/** Shapes the rule must report (each is reported once, at the later route's register_rest_route line). */
export const SHADOW_SHAPES = {
  postAfterEditable: shadowFile(route(ITEM, "WP_REST_Server::EDITABLE") + route('/items/prices', "WP_REST_Server::CREATABLE")),
  loopVariable: shadowFile(`	foreach ( array( 'demo/v1', 'demo/v2' ) as $ns ) {\n${route(ITEM, "'POST'", '$ns')}${route('/items/prices', "'POST'", '$ns')}	}\n`),
};

/** Shapes the rule must leave alone. */
export const SHADOW_SILENT = {
  literalFirst: shadowFile(route('/items/prices', "'POST'") + route(ITEM, "'POST'")),
  differentVerb: shadowFile(route(ITEM, "'GET'") + route('/items/prices', "'POST'")),
  differentNamespace: shadowFile(route(ITEM, "'POST'") + route('/items/prices', "'POST'", "'other/v1'")),
  patternDoesNotMatch: shadowFile(route('/items/(?P<id>\\d+)', "'POST'") + route('/items/prices', "'POST'")),
  longerPath: shadowFile(route(ITEM, "'POST'") + route('/items/prices/export', "'POST'")),
  twoPatterns: shadowFile(route(ITEM, "'POST'") + route('/items/(?P<slug>[a-z]+)/x', "'POST'")),
  unrelatedVariables: shadowFile(`	foreach ( array( 'a' ) as $one ) {\n${route(ITEM, "'POST'", '$one')}	}\n	foreach ( array( 'a' ) as $two ) {\n${route('/items/prices', "'POST'", '$two')}	}\n`),
};

export const SHADOW_FIXTURES = {
  SECURITY_WP_SHADOWED_ROUTE: {
    path: PATH,
    config: CONFIG,
    bad: SHADOW_SHAPES.postAfterEditable,
    good: SHADOW_SILENT.literalFirst,
  },
};
