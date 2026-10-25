// Fixtures for the WordPress route rules (design spec 8.1). Strings, never .php files; names are generic.
// A "plugin" is { relativePath: source } written to a temp directory by the spec.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPassContext } from './pass-context.js';
import { getProjectIndex, resetProjectIndexCache } from '../../php/wp-project-index.js';
import { wpRouteRegistrations } from '../../php/wp-route-rules.js';

const PATH = 'wp-content/plugins/demo/demo.php';
const CONFIG = { rules: {}, overrides: [], wordpress: true };
const READ_CONFIG = { rules: { SECURITY_WP_PUBLIC_READ_SIDE_EFFECT: 'on' }, overrides: [], wordpress: true };

export const HEADER = `<?php
/**
 * Plugin Name: Demo
 */
`;

/** Writes a plugin to a fresh temp directory; returns { root, cleanup }. */
export function writePlugin(files) {
  resetProjectIndexCache();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wp-routes-')));
  for (const [rel, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), source);
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Runs the route passes over every file of a plugin on disk; returns the records, each with its `file`. */
export function auditPlugin(root, { crossFile = true, passes = wpRouteRegistrations } = {}) {
  const index = getProjectIndex(root);
  const wp = { isWordPress: true, root, kind: 'plugin' };
  return index.files().flatMap((rel) => {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const ctx = buildPassContext(source, { path: path.join(root, rel), index, wp, crossFile });
    ctx.relativePath = rel;
    for (const pass of passes) pass.run(ctx);
    return ctx.records.map((r) => ({ ...r, file: rel }));
  });
}

/** Writes the files, audits them, removes the directory. */
export function auditFiles(files, options) {
  const plugin = writePlugin(files);
  try {
    return auditPlugin(plugin.root, options);
  } finally {
    plugin.cleanup();
  }
}

/** One demo.php with a registration for `endpoint` (an array literal body) and the given extra code. */
export function routeFile(args, rest = '') {
  return `${HEADER}add_action( 'rest_api_init', 'demo_register_routes' );
function demo_register_routes() {
	register_rest_route( 'demo/v1', '/save', ${args} );
}
${rest}`;
}

const SAVE = `function demo_save( $request ) {
	update_option( 'demo_value', sanitize_text_field( wp_unslash( $request->get_param( 'v' ) ) ) );
	return rest_ensure_response( array( 'ok' => true ) );
}
`;

export const ROUTES_FIXTURES = {
  SECURITY_WP_PUBLIC_WRITE_ROUTE: {
    path: PATH,
    config: CONFIG,
    bad: routeFile(`array(
		'methods'             => 'POST',
		'callback'            => 'demo_save',
		'permission_callback' => '__return_true',
	)`, SAVE),
    good: routeFile(`array(
		'methods'             => 'POST',
		'callback'            => 'demo_save',
		'permission_callback' => 'demo_can_save',
	)`, `function demo_can_save() {
	return current_user_can( 'manage_options' );
}
${SAVE}`),
  },
  SECURITY_WP_REST_NO_PERMISSION_CALLBACK: {
    path: PATH,
    config: CONFIG,
    bad: routeFile(`array(
		'methods'  => 'GET',
		'callback' => 'demo_read',
	)`, `function demo_read() {
	return rest_ensure_response( array( 'ok' => true ) );
}
`),
    // The WordPress core controller shape: top-level args and schema keys, numeric endpoints each with a permission_callback.
    good: routeFile(`array(
		'args' => array(
			'id' => array( 'type' => 'integer' ),
		),
		array(
			'methods'             => 'GET',
			'callback'            => 'demo_read',
			'permission_callback' => 'demo_can_read',
		),
		'schema' => 'demo_schema',
	)`, `function demo_can_read() {
	return current_user_can( 'read' );
}
function demo_read() {
	return rest_ensure_response( array( 'ok' => true ) );
}
function demo_schema() {
	return array( 'title' => 'demo' );
}
`),
  },
  SECURITY_WP_PUBLIC_READ_SIDE_EFFECT: {
    path: PATH,
    config: READ_CONFIG,
    bad: routeFile(`array(
		'methods'             => 'GET',
		'callback'            => 'demo_read',
		'permission_callback' => '__return_true',
	)`, `function demo_read() {
	update_option( 'demo_seen', 1 );
	return rest_ensure_response( array( 'ok' => true ) );
}
`),
    good: routeFile(`array(
		'methods'             => 'GET',
		'callback'            => 'demo_read',
		'permission_callback' => '__return_true',
	)`, `function demo_read() {
	return rest_ensure_response( array( 'seen' => get_option( 'demo_seen' ) ) );
}
`),
  },
};
