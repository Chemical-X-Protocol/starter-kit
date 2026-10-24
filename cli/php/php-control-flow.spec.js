import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { PHP_STRUCTURE_FIXTURES } from '../fixtures/php/structure.fixtures.js';
import { controlFlowPass, nestedTernaryPass, cascadeGuardsPass, silentGuardPass, RULE_DEFAULTS } from './php-control-flow.js';

const hits = (pass, code) => {
  const ctx = buildPassContext(code);
  pass(ctx);
  return ctx.records;
};
const fn = (name, body, params = '$a, $b, $c') => `<?php\nfunction ${name}(${params}) {\n${body}\n}\n`;

test('nested ternary: the outermost of a chain reports once, at MEDIUM', () => {
  const records = hits(nestedTernaryPass, fn('demo', 'return $a ? 1 : ($b ? 2 : ($c ? 3 : 4));'));
  assert.equal(records.length, 1);
  assert.equal(records[0].rule, 'CONTROL_FLOW_NESTED_TERNARY');
  assert.equal(records[0].severity, 'MEDIUM');
});

test('nested ternary: a nested branch in the true position reports', () => {
  assert.equal(hits(nestedTernaryPass, fn('demo', 'return $a ? ($b ? 1 : 2) : 3;')).length, 1);
});

test('nested ternary: a pure short-ternary chain is exempt', () => {
  assert.equal(hits(nestedTernaryPass, fn('demo', 'return $a ?: ($b ?: $c);')).length, 0);
  assert.equal(hits(nestedTernaryPass, fn('demo', 'return $a ?: ($b ?: ($c ?: 1));')).length, 0);
});

test('nested ternary: a short ternary around a full ternary still reports', () => {
  assert.equal(hits(nestedTernaryPass, fn('demo', 'return $a ?: ($b ? 1 : 2);')).length, 1);
});

test('nested ternary: a ternary in test position is not flagged, matching the JS rule', () => {
  assert.equal(hits(nestedTernaryPass, fn('demo', 'return ($a ? 1 : 2) ? $b : $c;')).length, 0);
});

test('nested ternary: ternaries that do not nest are silent', () => {
  assert.equal(hits(nestedTernaryPass, fn('demo', '$x = $a ? 1 : 2; $y = $b ? 3 : 4; return $x + $y;')).length, 0);
});

const guard = (test) => `  if (${test}) {\n    return;\n  }`;

test('cascade: three guards then an action report once at the first guard', () => {
  const code = fn('demo', `${guard('$a')}\n${guard('$b')}\n${guard('$c')}\n  run();`);
  const records = hits(cascadeGuardsPass, code);
  assert.equal(records.length, 1);
  assert.equal(records[0].line, 3);
});

test('cascade: two guards are silent, so are three guards at the end of the list', () => {
  assert.equal(hits(cascadeGuardsPass, fn('demo', `${guard('$a')}\n${guard('$b')}\n  run();`)).length, 0);
  assert.equal(hits(cascadeGuardsPass, fn('demo', `  run();\n${guard('$a')}\n${guard('$b')}\n${guard('$c')}`)).length, 0);
});

test('cascade: throw guards count, and a guard with an else does not', () => {
  const throws = (test) => `  if (${test}) {\n    throw new Exception('x');\n  }`;
  assert.equal(hits(cascadeGuardsPass, fn('demo', `${throws('$a')}\n${throws('$b')}\n${throws('$c')}\n  run();`)).length, 1);
  const withElse = '  if ($b) {\n    return;\n  } else {\n    run();\n  }';
  assert.equal(hits(cascadeGuardsPass, fn('demo', `${guard('$a')}\n${withElse}\n${guard('$c')}\n  run();`)).length, 0);
});

test('cascade: plain assignments between guards are skipped', () => {
  const code = fn('demo', `${guard('$a')}\n  $x = 1;\n${guard('$b')}\n  $y = 2;\n${guard('$c')}\n  run();`);
  assert.equal(hits(cascadeGuardsPass, code).length, 1);
});

test('cascade: a guard that only tests the variable the line before it assigned does not count', () => {
  const loaded = (name, call) => `  $${name} = ${call}();\n  if (!$${name}) {\n    return;\n  }`;
  const code = fn('demo', `${loaded('order', 'load_order')}\n${loaded('user', 'load_user')}\n${loaded('item', 'load_item')}\n  run();`);
  assert.equal(hits(cascadeGuardsPass, code).length, 0);
});

test('cascade: a guard that reads more than the assigned variable still counts', () => {
  const code = fn('demo', `  $x = load();\n  if (!$x || $a) {\n    return;\n  }\n${guard('$b')}\n${guard('$c')}\n  run();`);
  assert.equal(hits(cascadeGuardsPass, code).length, 1);
});

test('cascade: a branch of more than three statements ending in return is a mode branch, not a guard', () => {
  const mode = (flag) => `  if (${flag}) {\n    one();\n    two();\n    three();\n    four();\n    return;\n  }`;
  assert.equal(hits(cascadeGuardsPass, fn('demo', `${mode('$a')}\n${mode('$b')}\n${mode('$c')}\n  run();`)).length, 0);
});

test('cascade: shorter mode branches still count, a documented false positive', () => {
  const mode = (flag) => `  if (${flag}) {\n    one();\n    return;\n  }`;
  assert.equal(hits(cascadeGuardsPass, fn('demo', `${mode('$a')}\n${mode('$b')}\n${mode('$c')}\n  run();`)).length, 1);
});

test('cascade: severity is left to the registry', () => {
  const code = fn('demo', `${guard('$a')}\n${guard('$b')}\n${guard('$c')}\n  run();`);
  assert.equal(hits(cascadeGuardsPass, code)[0].severity, undefined);
});

const silent = (name, test, body = '    return;') => fn(name, `  if (${test}) {\n${body}\n  }\n  update_option('demo', 1);`, '$result, $data');

test('silent guard: a bare return under an error test in a mutation-named function reports', () => {
  const records = hits(silentGuardPass, silent('save_demo', 'is_wp_error( $result )'));
  assert.equal(records.length, 1);
  assert.equal(records[0].rule, 'CONTROL_FLOW_SILENT_GUARD');
});

test('silent guard: snake_case mutation prefixes are recognised, other names are not', () => {
  for (const name of ['handle_demo', 'on_demo', 'update_demo', 'delete_demo', 'send_demo']) {
    assert.equal(hits(silentGuardPass, silent(name, 'is_wp_error( $result )')).length, 1, name);
  }
  for (const name of ['demo_save', 'get_demo', 'is_demo_ready', 'render_demo']) {
    assert.equal(hits(silentGuardPass, silent(name, 'is_wp_error( $result )')).length, 0, name);
  }
});

test('silent guard: every reporting call and error-response form makes the guard non-silent', () => {
  const bodies = [
    "    error_log( 'x' );\n    return;",
    "    wp_send_json_error( 'x' );\n    return;",
    "    wp_die( 'x' );\n    return;",
    "    status_header( 400 );\n    return;",
    "    add_settings_error( 'a', 'b', 'c' );\n    return;",
    "    wp_safe_redirect( '/x' );\n    return;",
    "    $this->log( 'x' );\n    return;",
    "    $this->warn_user( 'x' );\n    return;",
    "    $this->respond( 'x' );\n    return;",
    "    $this->errors[] = 'x';\n    return;",
    "    $out['error'] = 'x';\n    return;",
    "    echo 'x';\n    return;",
    "    throw new Exception( 'x' );",
  ];
  for (const body of bodies) {
    assert.equal(hits(silentGuardPass, silent('save_demo', 'is_wp_error( $result )', body)).length, 0, body);
  }
});

test('silent guard: error words must be whole identifiers, never text inside an array-key string', () => {
  assert.equal(hits(silentGuardPass, silent('save_demo', "isset( $data['error_code'] )")).length, 0);
  assert.equal(hits(silentGuardPass, silent('save_demo', "! empty( $data['failed'] )")).length, 0);
  assert.equal(hits(silentGuardPass, silent('save_demo', '! empty( $data->failed )')).length, 1);
  assert.equal(hits(silentGuardPass, silent('save_demo', '$has_error')).length, 1);
  assert.equal(hits(silentGuardPass, silent('save_demo', '$errorless')).length, 0);
});

test('silent guard: a negated outcome name counts as an error test', () => {
  assert.equal(hits(silentGuardPass, silent('save_demo', '! $is_valid')).length, 1);
});

test('silent guard: benign control words in the test are exempt', () => {
  assert.equal(hits(silentGuardPass, silent('save_demo', '$timeout_failed')).length, 0);
});

test('silent guard: an add_filter closure that tests is_wp_error on a passed-in argument is exempt', () => {
  const code = "<?php\nadd_filter( 'demo_hook', function ( $value ) {\n  if ( is_wp_error( $value ) ) {\n    return;\n  }\n  update_option( 'demo', $value );\n} );\n";
  assert.equal(hits(silentGuardPass, code).length, 0);
});

test('silent guard: a method registered with add_action in the same file is exempt, an unregistered one is not', () => {
  const method = (name) => `  public function ${name}( $errors ) {\n    if ( $errors->get_error_message( 'pass' ) ) {\n      return;\n    }\n    update_option( 'demo', 1 );\n  }`;
  const registered = `<?php\nclass Demo_Box {\n  public function __construct() { add_action( 'demo_hook', [ $this, 'on_demo' ] ); }\n${method('on_demo')}\n}\n`;
  const unregistered = `<?php\nclass Demo_Box {\n${method('on_demo')}\n}\n`;
  assert.equal(hits(silentGuardPass, registered).length, 0);
  assert.equal(hits(silentGuardPass, unregistered).length, 1);
});

const FAMILY = ['CONTROL_FLOW_NESTED_TERNARY', 'CONTROL_FLOW_CASCADE_GUARDS', 'CONTROL_FLOW_SILENT_GUARD'];

for (const id of FAMILY) {
  test(`${id}: fixture pair, bad fires and good is silent`, () => {
    const fixture = PHP_STRUCTURE_FIXTURES[id];
    const bad = buildPassContext(fixture.bad, { path: fixture.path, config: fixture.config });
    controlFlowPass(bad);
    assert.deepEqual([...new Set(bad.records.map((r) => r.rule))], [id]);
    const good = buildPassContext(fixture.good, { path: fixture.path, config: fixture.config });
    controlFlowPass(good);
    assert.deepEqual(good.records, []);
  });
}

async function passesOnMain() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((name) => /^(?:php|wp)-[a-z-]+\.js$/.test(name));
  const found = [];
  for (const name of files) {
    const mod = await import(pathToFileURL(path.join(dir, name)).href).catch(() => ({}));
    for (const [exportName, value] of Object.entries(mod)) {
      const isPass = /Pass$/.test(exportName) && typeof value === 'function';
      found.push(...(isPass ? [{ label: `${name}:${exportName}`, pass: value }] : []));
    }
  }
  return found;
}

test('every good fixture is clean under every pass already on main', async () => {
  const passes = await passesOnMain();
  assert.ok(passes.length >= 5, `expected the structural passes at least, found ${passes.length}`);
  for (const [id, fixture] of Object.entries(PHP_STRUCTURE_FIXTURES)) {
    for (const { label, pass } of passes) {
      const ctx = buildPassContext(fixture.good, { path: fixture.path, config: fixture.config });
      pass(ctx);
      assert.deepEqual(ctx.records, [], `${id} good fixture under ${label}`);
    }
  }
});

test('RULE_DEFAULTS covers the three ids with measured evidence; the two heuristics ship off', () => {
  assert.deepEqual(Object.keys(RULE_DEFAULTS).sort(), [...FAMILY].sort());
  assert.equal(RULE_DEFAULTS.CONTROL_FLOW_NESTED_TERNARY.defaultOn, true);
  assert.equal(RULE_DEFAULTS.CONTROL_FLOW_CASCADE_GUARDS.defaultOn, false);
  assert.equal(RULE_DEFAULTS.CONTROL_FLOW_SILENT_GUARD.defaultOn, false);
});
