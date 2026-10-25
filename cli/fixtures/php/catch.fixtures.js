// Fixture pairs for the PHP catch and logging rules (design spec 3.3): { RULE_ID: { path, config, bad, good } }.
// Fixtures are JS strings, never .php files. Names are generic.
const CONFIG = { rules: {}, overrides: [], wordpress: true };

export const CATCH_FIXTURES = {
  ERROR_SWALLOWED_EXCEPTION: {
    path: 'includes/class-demo-client.php',
    config: CONFIG,
    bad: `<?php
class Demo_Client {
    public function demo_fetch( $id ) {
        try {
            return $this->remote( $id );
        } catch ( Exception $e ) {
            // ignore
        }
        return null;
    }
}
`,
    good: `<?php
class Demo_Client {
    public function demo_fetch( $id ) {
        try {
            return $this->remote( $id );
        } catch ( Exception $e ) {
            throw new RuntimeException( 'Demo fetch failed', 0, $e );
        }
    }
}
`,
  },
  AI_SLOP_SHALLOW_CATCH: {
    path: 'includes/class-demo-client.php',
    config: CONFIG,
    bad: `<?php
class Demo_Client {
    public function demo_fetch( $id ) {
        try {
            return $this->remote( $id );
        } catch ( Exception $e ) {
            error_log( $e->getMessage() );
        }
        return null;
    }
}
`,
    good: `<?php
class Demo_Client {
    public function demo_fetch( $id ) {
        try {
            return $this->remote( $id );
        } catch ( Exception $e ) {
            error_log( $e->getMessage() );
            return new WP_Error( 'demo_fetch', 'Demo fetch failed' );
        }
    }
}
`,
  },
  // Off for PHP until a setting names it (RULE_DEFAULTS in cli/php/php-logging.js), so the config switches it on.
  UNGUARDED_LOGGING: {
    path: 'includes/demo-debug.php',
    config: { ...CONFIG, rules: { UNGUARDED_LOGGING: 'on' } },
    bad: `<?php
function demo_render( $items ) {
    var_dump( $items );
    return count( $items );
}
`,
    good: `<?php
function demo_render( $items ) {
    $dump = print_r( $items, true );
    if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
        error_log( 'demo_render ' . $dump );
    }
    return count( $items );
}
`,
  },
};
