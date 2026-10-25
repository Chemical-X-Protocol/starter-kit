// Fixtures for SECURITY_WP_UNBOUNDED_REQUEST_ARRAY (task #6717). Strings, never .php files; names are generic.
import { HEADER } from './routes.fixtures.js';

const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: { SECURITY_WP_UNBOUNDED_REQUEST_ARRAY: 'on' }, overrides: [], wordpress: true };

const route = (args = '') => `	register_rest_route( 'demo/v1', '/sync', array(
		'methods'             => 'POST',
		'callback'            => array( $this, 'handle_sync' ),
		'permission_callback' => array( $this, 'can_sync' ),${args}
	) );
`;

/** One demo.php with a class whose handle_sync method has the given body; `extra` adds class members or code. */
export const boundsFile = (body, { routeArgs = '', extra = '' } = {}) => `${HEADER}class Demo_Api {
	public function register() {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}
	public function routes() {
${route(routeArgs)}	}
	public function can_sync() { return current_user_can( 'read' ); }
	public function handle_sync( $request ) {
${body}	}
${extra}}
`;

const LOOP = "		$params = $request->get_json_params();\n		$items = isset( $params['items'] ) && is_array( $params['items'] ) ? $params['items'] : array();\n		foreach ( $items as $item ) {\n			update_user_meta( 1, 'item', $item );\n		}\n		return 1;\n";

/** Shapes the rule must report (each once, at the loop or call line). */
export const BOUNDS_SHAPES = {
  loopOverParam: boundsFile(LOOP),
  loopOverDirect: boundsFile("		foreach ( $request->get_json_params()['items'] as $item ) {\n			update_user_meta( 1, 'item', $item );\n		}\n		return 1;\n"),
  countOnlyForDisplay: boundsFile(LOOP.replace('return 1;', "return count( $items );")),
  callee: boundsFile("		$params = $request->get_json_params();\n		return self::store( 1, $params['items'] );\n", {
    extra: "	private static function store( $user, $items ) {\n		foreach ( $items as $item ) {\n			update_user_meta( $user, 'item', $item );\n		}\n		return true;\n	}\n",
  }),
};

/** Shapes the rule must leave alone. */
export const BOUNDS_SILENT = {
  countCap: boundsFile(LOOP.replace('		foreach', "		if ( count( $items ) > 100 ) {\n			return new WP_Error( 'too_many', 'Too many', array( 'status' => 413 ) );\n		}\n		foreach")),
  sliceCap: boundsFile(LOOP.replace("? $params['items']", "? array_slice( $params['items'], 0, 100 )")),
  chunkCap: boundsFile(LOOP.replace('foreach ( $items as', 'foreach ( array_chunk( $items, 50 ) as')),
  schemaMaxItems: boundsFile(LOOP, { routeArgs: "\n		'args' => array( 'items' => array( 'type' => 'array', 'maxItems' => 100 ) )," }),
  loopOverLiteral: boundsFile("		foreach ( array( 'a', 'b' ) as $item ) {\n			update_user_meta( 1, 'item', $item );\n		}\n		return 1;\n"),
  scalarOnly: boundsFile("		$id = absint( $request->get_param( 'id' ) );\n		update_user_meta( $id, 'seen', 1 );\n		return 1;\n"),
  calleeCapped: boundsFile("		$params = $request->get_json_params();\n		return self::store( 1, $params['items'] );\n", {
    extra: "	private static function store( $user, $items ) {\n		if ( count( $items ) > 100 ) {\n			return false;\n		}\n		foreach ( $items as $item ) {\n			update_user_meta( $user, 'item', $item );\n		}\n		return true;\n	}\n",
  }),
  calleeNoLoop: boundsFile("		$params = $request->get_json_params();\n		return self::store( 1, $params['items'] );\n", {
    extra: "	private static function store( $user, $items ) {\n		update_user_meta( $user, 'items', $items );\n		return true;\n	}\n",
  }),
  readVerb: boundsFile(LOOP).replace("'POST'", "'GET'"),
};

export const BOUNDS_FIXTURES = {
  SECURITY_WP_UNBOUNDED_REQUEST_ARRAY: {
    path: PATH,
    config: CONFIG,
    bad: BOUNDS_SHAPES.loopOverParam,
    good: BOUNDS_SILENT.countCap,
  },
};
