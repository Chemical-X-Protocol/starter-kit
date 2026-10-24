// Precision regression for the PHP structural rules (design spec 8.3). Each case is a
// minimal, generic snippet reproducing the SHAPE of one labelled hit; `origin` names the
// hit(s) it stands for and `weight` how many labelled hits it counts as. Weighted
// precision is TP / (TP + known false positives that still fire); a guarded false
// positive (label FP, no `known`) must stay silent and does not enter the figure.
// The snippets reproduce shapes, not verbatim code, so the figures are only as good as
// that reduction. Labels: task comment on #6472.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPassContext } from '../fixtures/php/pass-context.js';
import { controlFlowPass, RULE_DEFAULTS as FLOW_DEFAULTS } from './php-control-flow.js';
import { metricsPass, RULE_DEFAULTS as METRIC_DEFAULTS } from './php-metrics.js';

const DEFAULTS = { ...METRIC_DEFAULTS, ...FLOW_DEFAULTS };
const fn = (name, body, params = '$a, $b, $c') => `<?php\nfunction ${name}(${params}) {\n${body}\n}\n`;
const ifs = (count) => Array.from({ length: count }, (_, i) => `  if ($a === ${i}) { $t++; }`).join('\n');
const guard = (test, body = '    return;') => `  if (${test}) {\n${body}\n  }`;
const loaded = (name) => `  $${name} = demo_load_${name}();\n${guard(`! $${name}`)}`;

const DEEP = fn('demo_walk', '  foreach ($a as $x) {\n    if ($x) {\n      foreach ($x as $y) {\n        if ($y) { demo_emit($y); }\n      }\n    }\n  }');
const DEFAULTS_ONLY = fn('demo_options', Array.from({ length: 13 }, (_, i) => `  $o['k${i}'] = $in['k${i}'] ?? 'd';`).join('\n'), '$in');
const MODE = (flag) => `  if (${flag}) {\n    demo_one();\n    demo_two();\n    return;\n  }`;
const SAVE_GUARDS = fn('demo_save', `${guard("! isset($_POST['demo_nonce'])")}\n${guard("defined('DOING_AUTOSAVE') && DOING_AUTOSAVE")}\n${guard("! current_user_can('edit_post', $a)")}\n  update_post_meta($a, 'demo', 1);`);

const silentBody = (name, test, setup = '') => fn(name, `${setup}\n${guard(test)}\n  update_option('demo', 1);`, '$result, $data, $errors');

const CASES = [
  { rule: 'COMPLEXITY_CYCLOMATIC_HIGH', set: 'corpus', label: 'TP', weight: 10, origin: 'corpus: 10 labelled functions over 12', code: fn('demo_score', `  $t = 0;\n${ifs(13)}\n  return $t;`) },
  { rule: 'COMPLEXITY_CYCLOMATIC_HIGH', set: 'corpus', label: 'FP', known: 'FP', weight: 2, origin: 'corpus: 2 flat ?? default lists (count right, directive wrong)', code: DEFAULTS_ONLY },
  { rule: 'STRUCTURAL_WEIGHT_EXCEEDED', set: 'corpus', label: 'TP', weight: 10, origin: 'corpus: 10 labelled depth-4 functions', code: DEEP },
  { rule: 'CONTROL_FLOW_NESTED_TERNARY', set: 'corpus', label: 'TP', weight: 11, origin: 'corpus: 11 of the 12 labelled nested ternaries (the 12th is the isset chain below)', code: fn('demo_label', '  return $a ? "x" : ($b ? "y" : "z");') },
  { rule: 'CONTROL_FLOW_NESTED_TERNARY', set: 'corpus', label: 'TP', weight: 1, origin: 'corpus: isset fallback chain', code: fn('demo_fallback', '  return isset($a) ? $a : (isset($b) ? $b : $c);') },
  { rule: 'CONTROL_FLOW_NESTED_TERNARY', set: 'corpus', label: 'FP', weight: 6, origin: 'corpus: 6 pure ?: chains', code: fn('demo_pick', '  return $a ?: ($b ?: ($c ?: "z"));') },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'corpus', label: 'TP', weight: 7, origin: 'corpus: alphabet-soup:357, bugnet:187, hookshot:127, magic-cloak:152, magic-formula:175, mirror-shield:425, quests:175 (nonce, autosave, capability)', code: SAVE_GUARDS },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'corpus', label: 'TP', weight: 1, origin: 'corpus: bazaar-admin-orders:767 (capability throw, then response-and-return guards)', code: fn('demo_toggle', `${guard('! current_user_can("manage")', '    throw new Exception("denied");')}\n${guard('! function_exists("WC")', '    demo_respond();\n    return;')}\n${guard('! $a', '    demo_respond();\n    return;')}\n  demo_apply($a);`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'corpus', label: 'FP', known: 'FP', weight: 1, origin: 'corpus: card-vault-catalog-cli:388 (flag branches that act, then return)', code: fn('demo_crawl', `${MODE('$a')}\n${MODE('$b')}\n${MODE('$c')}\n${MODE('$d')}\n  demo_run();`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'corpus', label: 'FP', known: 'FP', weight: 1, origin: 'corpus: card-vault-admin:226 (is_admin guard, option-page branch that works then returns, empty guard)', code: fn('demo_submit', `${guard('! is_admin()')}\n${MODE('$a')}\n${guard('empty($b)')}\n  demo_run();`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'corpus', label: 'FP', weight: 15, origin: 'corpus: bazaar-admin-orders:180,210,678,716,813,998,1054,1245,1330; compass-admin:712; bomb-bag:27; bugnet:655; enchiridion:107; pegasus-boots:27,32 (load-then-check leaves fewer than 3 guards)', code: fn('demo_orders', `${guard('! current_user_can("manage")')}\n${loaded('order')}\n${loaded('gateways')}\n${loaded('coupon')}\n  demo_apply($order);`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'TP', weight: 5, origin: 'held-out: akismet:1217, snapshot-backups class-main:289, class-login:40, wp-defender notfound-lockout:57, wpmu-dev-seo class-admin:196', code: SAVE_GUARDS },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'TP', weight: 2, origin: 'held-out: forminator googlesheet form-hooks:304, hustle providers:253 (throw guards, then use)', code: fn('demo_register', `${guard('! $a', '    throw new Exception("a");')}\n${guard('empty($b)', '    throw new Exception("b");')}\n${guard('empty($c)', '    throw new Exception("c");')}\n  demo_use($a, $b, $c);`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'TP', weight: 1, origin: 'held-out: wp-defender strong-password:272', code: fn('demo_reset', `${guard('null === $a')}\n${guard('! demo_enforced($a)')}\n${guard('demo_is_woo() && ! demo_woo_enabled()')}\n  demo_apply($a);`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'TP', weight: 1, origin: 'held-out: snapshot-backups tpl/notices/reauthenticate-dropbox:12 (template guards before markup)', code: `<?php\n${guard('empty($a)')}\n${guard('! isset($b["unauthorized"])')}\n${guard('$c')}\n$class = "demo";\n?>\n<div class="<?php echo esc_attr( $class ); ?>"></div>\n` },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: snapshot-backups class-credentials:55 (the validator itself)', code: fn('validate', `${guard('empty($a) && empty($b)', '    throw new Exception("none");')}\n${guard('empty($a)', '    throw new Exception("a");')}\n${guard('empty($b)', '    throw new Exception("b");')}\n  return true;`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: snapshot-backups class-main:222 (guards after separate API calls)', code: fn('demo_migrate', `  $task->apply($a);\n${guard('$task->has_errors()', '    demo_retry();\n    return;')}\n${guard('$task->is_done()', '    demo_mark();\n    return;')}\n${guard('$task->is_locked()')}\n  demo_next();`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: wp-defender session-protection:112 (guards, then a branch that acts and returns)', code: fn('demo_timeout', `${guard('! is_user_logged_in()')}\n${guard('! demo_can_apply()')}\n${MODE('$a')}\n  demo_idle();`).replace('demo_one();\n    demo_two();', 'demo_lock();') },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: hustle class-opt-in-condition-on-browser:72 (throw used as a result)', code: fn('demo_browser', `${guard('! $a', '    throw new Exception("none");')}\n${guard('strpos($a, "Opera")', '    throw new Exception("opera");')}\n${guard('strpos($a, "Edg")', '    throw new Exception("edge");')}\n  return "other";`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: card vault 650b4aa class-card-vault-admin:226', code: fn('demo_submit', `${guard('! is_admin()')}\n${MODE('$a')}\n${guard('empty($b)')}\n  demo_run();`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: card vault 650b4aa class-card-vault-catalog-cli:388', code: fn('demo_crawl', `${MODE('$a')}\n${MODE('$b')}\n${MODE('$c')}\n${MODE('$d')}\n  demo_run();`) },
  { rule: 'CONTROL_FLOW_CASCADE_GUARDS', set: 'heldOut', label: 'FP', weight: 1, origin: 'held-out review: bazaar admin-orders:678 (load-then-check)', code: fn('demo_gateways', `${guard('! current_user_can("manage")', '    throw new Exception("denied");')}\n${guard('! function_exists("WC")')}\n${loaded('gateways')}\n${loaded('data')}\n  demo_apply($gateways);`) },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'corpus', label: 'TP', weight: 1, origin: 'corpus: magic-wand public:792', code: silentBody('sync_demo', '! $is_valid_sections_array', '  $is_valid_sections_array = is_array($data);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'TP', weight: 2, origin: 'held-out: wp-defender password-protection:147,187 (is_wp_error on an API result)', code: silentBody('handle_demo', 'is_wp_error( $is_pwned )', '  $is_pwned = demo_check($data);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'TP', weight: 2, origin: 'held-out: hustle form-settings:216, convertkit-form-hooks:60', code: silentBody('save_demo', 'is_wp_error( $module )', '  $module = Demo_Module::new_instance($data);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'TP', weight: 1, origin: 'held-out: wpmu-dev-seo sitemaps/class-controller:303', code: silentBody('handle_demo_deletion', 'is_wp_error( $term )', '  $term = get_term($data);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: wp-defender strong-password:243 (hook registered in another file)', code: silentBody('on_demo_update', "'' !== $errors->get_error_message( 'pass' )") },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', known: 'FP', weight: 1, origin: 'held-out: wp-defender mask-login:921 (cleans up, then returns)', code: fn('handle_demo_reset', '  if ( is_wp_error( $a ) ) {\n    delete_site_transient( "k" );\n    setcookie( "c", " ", 0 );\n    return;\n  }\n  update_option("demo", 1);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', weight: 1, origin: 'held-out review: wp-defender class-blacklist:757 ($this->log reports)', code: fn('update_demo_database', '  if ( is_wp_error( $a ) ) {\n    $this->log( "download error: " . $a->get_error_message() );\n    return;\n  }\n  update_option("demo", 1);') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', weight: 1, origin: 'held-out review: wp-defender class-password-protection:124 (hook callback no-op)', code: `<?php\nclass Demo_Box {\n  public function __construct() { add_action( 'demo_reset', [ $this, 'handle_demo_reset' ], 10, 2 ); }\n  public function handle_demo_reset( WP_Error $errors, $user ) {\n    if ( is_wp_error( $user ) ) {\n      return;\n    }\n    update_option( 'demo', 1 );\n  }\n}\n` },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', weight: 1, origin: 'held-out review: snapshot-backups class-backup:438 (on_fail_send is an array key)', code: fn('send_demo_email', "  if ( ! $email_settings['on_fail_send'] || ! $email_settings['notify_on_complete'] ) {\n    return;\n  }\n  wp_mail( 'x', 'y', 'z' );", '$email_settings') },
  { rule: 'CONTROL_FLOW_SILENT_GUARD', set: 'heldOut', label: 'FP', weight: 1, origin: 'held-out review: hustle page-abstract:229 (add_action reports the redirect)', code: fn('on_demo_wizard', '  if ( is_wp_error( $a ) ) {\n    add_action( "admin_init", [ $this, "redirect_not_found" ] );\n    return;\n  }\n  update_option("demo", 1);') },
];

const run = (code) => {
  const ctx = buildPassContext(code);
  metricsPass(ctx);
  controlFlowPass(ctx);
  return ctx.records;
};
const firedFor = (testCase) => run(testCase.code).some((record) => record.rule === testCase.rule);

CASES.forEach((testCase, index) => {
  const expectation = testCase.label === 'TP' || testCase.known === 'FP' ? 'fires' : 'stays silent';
  test(`${testCase.rule} #${index} ${testCase.label}${testCase.known ? ' (known FP)' : ''} ${expectation}: ${testCase.origin.slice(0, 70)}`, () => {
    assert.equal(firedFor(testCase), expectation === 'fires');
  });
});

const precision = (rule, set) => {
  const fired = CASES.filter((c) => c.rule === rule && c.set === set && (c.label === 'TP' || c.known === 'FP'));
  const tp = fired.filter((c) => c.label === 'TP').reduce((sum, c) => sum + c.weight, 0);
  const total = fired.reduce((sum, c) => sum + c.weight, 0);
  return { tp, total, ratio: total ? tp / total : null, text: `${tp}/${total}` };
};

const RULES = [...new Set(CASES.map((c) => c.rule))];

for (const rule of RULES) {
  test(`${rule}: RULE_DEFAULTS records the measured figures and the default follows the 80% bar`, () => {
    const corpus = precision(rule, 'corpus');
    const heldOut = precision(rule, 'heldOut');
    assert.equal(DEFAULTS[rule].corpus, corpus.text);
    const heldOutMeasured = heldOut.total > 0;
    if (heldOutMeasured) assert.equal(DEFAULTS[rule].heldOut, heldOut.text);
    const sets = [corpus, heldOut].filter((s) => s.total > 0);
    const meetsBar = sets.every((s) => s.ratio >= 0.8) && (heldOutMeasured || /held up/.test(DEFAULTS[rule].heldOut));
    assert.equal(DEFAULTS[rule].defaultOn, meetsBar, `${rule} corpus ${corpus.text} held-out ${heldOut.text}`);
  });
}

test('CONTROL_FLOW_SILENT_GUARD ships off for PHP whatever the figures say (spec section 4)', () => {
  assert.equal(DEFAULTS.CONTROL_FLOW_SILENT_GUARD.defaultOn, false);
});

test('the held-out cascade set has at least 10 labelled hits', () => {
  const labelled = CASES.filter((c) => c.rule === 'CONTROL_FLOW_CASCADE_GUARDS' && c.set === 'heldOut').reduce((sum, c) => sum + c.weight, 0);
  assert.ok(labelled >= 10, `labelled ${labelled}`);
});

test('every case has a weight and an origin', () => {
  for (const c of CASES) {
    assert.ok(c.weight >= 1 && c.origin.length > 0);
  }
});
