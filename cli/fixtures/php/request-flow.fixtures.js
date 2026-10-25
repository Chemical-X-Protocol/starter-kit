// Fixtures for the request-flow and output rules (design spec 4, 8.1). Strings, never .php files; names are generic.
// A "plugin" is { relativePath: source } written to a temp directory by the spec (writePlugin).
import path from 'node:path';
import fs from 'node:fs';
import { buildPassContext } from './pass-context.js';
import { getProjectIndex } from '../../php/wp-project-index.js';
import { wpRequestFlowPass } from '../../php/wp-request-flow.js';
import { writePlugin } from './nonce.fixtures.js';

export { writePlugin };

const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: {}, overrides: [], wordpress: true };
const OUTPUT_CONFIG = { rules: { SECURITY_WP_UNESCAPED_OUTPUT: 'on' }, overrides: [], wordpress: true };

export const REQUEST_FLOW_FIXTURES = {
  SECURITY_WP_UNSANITIZED_INPUT: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_save() {
	update_option( 'demo_value', wp_unslash( $_POST['v'] ) );
}
`,
    good: `<?php
function demo_save() {
	update_option( 'demo_value', sanitize_text_field( wp_unslash( $_POST['v'] ) ) );
}
`,
  },
  SECURITY_WP_SSRF: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_probe( $request ) {
	$url = $request->get_param( 'url' );
	return wp_remote_get( $url );
}
`,
    good: `<?php
function demo_probe( $request ) {
	$url = $request->get_param( 'url' );
	if ( ! wp_http_validate_url( $url ) ) {
		return new WP_Error( 'demo_bad_url', 'Invalid URL.' );
	}
	return wp_remote_get( $url );
}
`,
  },
  SECURITY_WP_OPEN_REDIRECT: {
    path: PATH,
    config: CONFIG,
    bad: `<?php
function demo_go( $request ) {
	$target = esc_url_raw( $request->get_param( 'fallback_url' ) );
	wp_redirect( $target );
	exit;
}
`,
    good: `<?php
function demo_go( $request ) {
	$target = esc_url_raw( $request->get_param( 'fallback_url' ) );
	wp_safe_redirect( $target );
	exit;
}
`,
  },
  SECURITY_WP_UNESCAPED_OUTPUT: {
    path: PATH,
    config: OUTPUT_CONFIG,
    bad: `<?php
function demo_show( $label ) {
	echo $label;
}
`,
    good: `<?php
function demo_show( $label ) {
	echo esc_html( $label );
}
`,
  },
};

const HEADER = '<?php\n/**\n * Plugin Name: Demo\n */\n';

/** Plugins whose flow crosses files: the finding sits at the call site in demo.php. */
export const REQUEST_FLOW_PLUGINS = {
  imageCache: {
    'demo.php': `${HEADER}function demo_image( $request ) {\n\treturn Demo_Cache::fetch( $request->get_param( 'src' ) );\n}\n`,
    'includes/class-demo-cache.php': `<?php\nclass Demo_Cache {\n\tpublic static function fetch( $url ) {\n\t\treturn wp_remote_get( $url );\n\t}\n}\n`,
  },
  sameFileMethod: {
    'demo.php': `${HEADER}class Demo_Api {\n\tpublic function handle( $request ) {\n\t\treturn $this->pull( $request->get_param( 'base' ) );\n\t}\n\tprivate function pull( $base ) {\n\t\treturn wp_remote_get( $base . '/data' );\n\t}\n}\n`,
  },
  redirectHelper: {
    'demo.php': `${HEADER}function demo_go( $request ) {\n\tdemo_bounce( $_GET['to'] );\n}\nfunction demo_bounce( $to ) {\n\twp_redirect( $to );\n}\n`,
  },
  pathOnly: {
    'demo.php': `${HEADER}function demo_image( $request ) {\n\treturn Demo_Cache::fetch( $request->get_param( 'src' ) );\n}\n`,
    'includes/class-demo-cache.php': `<?php\nclass Demo_Cache {\n\tpublic static function fetch( $name ) {\n\t\treturn wp_remote_get( 'https://cdn.example.test/' . $name );\n\t}\n}\n`,
  },
  validatedCallee: {
    'demo.php': `${HEADER}function demo_image( $request ) {\n\treturn Demo_Cache::fetch( $request->get_param( 'src' ) );\n}\n`,
    'includes/class-demo-cache.php': `<?php\nclass Demo_Cache {\n\tpublic static function fetch( $url ) {\n\t\tif ( ! wp_http_validate_url( $url ) ) {\n\t\t\treturn null;\n\t\t}\n\t\treturn wp_remote_get( $url );\n\t}\n}\n`,
  },
};

/** Runs the request-flow pass over every file of a plugin on disk; returns records with their `file`. */
export function auditRequestFlowPlugin(root, { crossFile = true } = {}) {
  const index = getProjectIndex(root);
  const wp = { isWordPress: true, root, kind: 'plugin' };
  return index.files().flatMap((rel) => {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const ctx = buildPassContext(source, { path: path.join(root, rel), index, wp, crossFile });
    ctx.relativePath = rel;
    wpRequestFlowPass(ctx);
    return ctx.records.map((record) => ({ ...record, file: rel }));
  });
}
