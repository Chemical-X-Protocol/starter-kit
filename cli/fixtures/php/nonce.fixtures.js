// Fixtures for SECURITY_WP_MISSING_NONCE (design spec 4). Strings, never .php files; names are generic.
// A "plugin" is { relativePath: source } written to a temp directory by the spec.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPassContext } from './pass-context.js';
import { getProjectIndex, resetProjectIndexCache } from '../../php/wp-project-index.js';
import { wpNoncePass } from '../../php/wp-nonce.js';

export const NONCE_PATH = 'demo.php';

/** Writes a plugin to a fresh temp directory; returns { root, cleanup }. */
export function writePlugin(files) {
  resetProjectIndexCache();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wp-nonce-')));
  for (const [rel, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), source);
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Runs the pass over every file of a plugin on disk; returns the records, each with its `file`. */
export function auditPlugin(root, { crossFile = true } = {}) {
  const index = getProjectIndex(root);
  const wp = { isWordPress: true, root, kind: 'plugin' };
  return index.files().flatMap((rel) => {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const ctx = buildPassContext(source, { path: path.join(root, rel), index, wp, crossFile });
    ctx.relativePath = rel;
    wpNoncePass(ctx);
    return ctx.records.map((r) => ({ ...r, file: rel }));
  });
}

const HEADER = `<?php
/**
 * Plugin Name: Demo
 */
`;

// The u2 pair. The good source writes a sanitized value so the unsanitized-input rule stays silent.
export const NONCE_FIXTURE = {
  path: NONCE_PATH,
  bad: `${HEADER}add_action( 'wp_ajax_demo_save', 'demo_save' );
function demo_save() {
    update_option( 'demo_value', 'on' );
    wp_send_json_success();
}
`,
  good: `${HEADER}add_action( 'wp_ajax_demo_save', 'demo_save' );
function demo_save() {
    check_ajax_referer( 'demo_save' );
    update_option( 'demo_value', sanitize_text_field( wp_unslash( $_POST['v'] ) ) );
    wp_send_json_success();
}
`,
};

const body = (check) => `{
        ${check}update_option( 'demo_value', 'on' );
    }`;

// Registration shapes. Each key is a plugin whose handler declaration is on line 7 of demo.php.
export const NONCE_SHAPES = {
  addAction: { 'demo.php': NONCE_FIXTURE.bad },
  admin_post: {
    'demo.php': `${HEADER}add_action( 'admin_post_demo_save', 'demo_save' );
function demo_save() {
    update_option( 'demo_value', 'on' );
}
`,
  },
  nopriv: {
    'demo.php': `${HEADER}add_action( 'wp_ajax_nopriv_demo_save', 'demo_save' );
function demo_save() {
    update_option( 'demo_value', 'on' );
}
`,
  },
  loader: {
    'demo.php': `${HEADER}class Demo_Plugin {
    private $loader;
    public function define_hooks() {
        $admin = new Demo_Admin();
        $this->loader->add_action( 'wp_ajax_demo_save', $admin, 'save' );
    }
}
`,
    'includes/class-demo-admin.php': `<?php
class Demo_Admin {
    public function save() ${body('')}
}
`,
  },
  hookMap: {
    'demo.php': `${HEADER}class Demo_Map {
    public $action_hooks = array( 'wp_ajax_demo_save' => 'save' );
    public function save() ${body('')}
}
`,
  },
  methodArray: {
    'demo.php': `${HEADER}class Demo_Page {
    public function boot() {
        add_action( 'wp_ajax_demo_save', array( $this, 'save' ) );
    }
    public function save() ${body('')}
}
`,
  },
  crossFile: {
    'demo.php': `${HEADER}require_once __DIR__ . '/includes/handlers.php';
add_action( 'wp_ajax_demo_save', 'demo_save' );
`,
    'includes/handlers.php': `<?php
function demo_save() {
    update_option( 'demo_value', 'on' );
}
`,
  },
  twoHopWrite: {
    'demo.php': `${HEADER}add_action( 'wp_ajax_demo_save', 'demo_save' );
function demo_save() {
    demo_store();
}
function demo_store() {
    update_option( 'demo_value', 'on' );
}
`,
  },
};

// Plugins that must stay silent.
export const NONCE_SILENT = {
  good: { 'demo.php': NONCE_FIXTURE.good },
  readOnly: {
    'demo.php': `${HEADER}add_action( 'wp_ajax_demo_read', 'demo_read' );
function demo_read() {
    wp_send_json_success( get_option( 'demo_value' ) );
}
`,
  },
  nonceNamedCall: {
    'demo.php': `${HEADER}add_action( 'wp_ajax_demo_save', 'demo_save' );
function demo_save() {
    demo_check_nonce();
    update_option( 'demo_value', 'on' );
}
`,
  },
  nonceInHelper: {
    'demo.php': `${HEADER}add_action( 'admin_post_demo_save', 'demo_save' );
function demo_save() {
    demo_guard();
    update_option( 'demo_value', 'on' );
}
function demo_guard() {
    check_admin_referer( 'demo_save' );
}
`,
  },
  notAHandler: {
    'demo.php': `${HEADER}add_action( 'init', 'demo_save' );
function demo_save() {
    update_option( 'demo_value', 'on' );
}
`,
  },
  parentHoldsCheck: {
    'demo.php': `${HEADER}$page = new \\Demo\\Admin\\Page();
add_action( 'wp_ajax_demo_save', array( $page, 'save' ) );
`,
    'includes/class-base.php': `<?php
namespace Demo\\Base;
abstract class Controller {
    protected function guard() {
        check_ajax_referer( 'demo' );
    }
}
`,
    'includes/class-page.php': `<?php
namespace Demo\\Admin;
use Demo\\Base\\Controller;
class Page extends Controller {
    public function save() {
        $this->guard();
        update_option( 'demo_value', 'on' );
    }
}
`,
  },
};

// The same page without the parent's check: the child's handler fires.
export const NONCE_NAMESPACED_BAD = {
  ...NONCE_SILENT.parentHoldsCheck,
  'includes/class-base.php': `<?php
namespace Demo\\Base;
abstract class Controller {
    protected function guard() {
        return true;
    }
}
`,
};
