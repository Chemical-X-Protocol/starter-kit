// Name vocabularies the per-file facts use to label calls (design spec 3.6 and rule table).
// A label is a name match only: it says nothing about arguments or whether the call is reachable.

const WRITE_FUNCTIONS = new Set([
  'add_option', 'update_option', 'delete_option', 'add_site_option', 'update_site_option', 'delete_site_option',
  'add_post_meta', 'update_post_meta', 'delete_post_meta', 'add_user_meta', 'update_user_meta', 'delete_user_meta',
  'add_term_meta', 'update_term_meta', 'delete_term_meta', 'add_comment_meta', 'update_comment_meta',
  'delete_comment_meta', 'set_transient', 'delete_transient', 'set_site_transient', 'delete_site_transient',
  'dbdelta', 'file_put_contents', 'unlink', 'rename', 'copy', 'mkdir', 'rmdir', 'touch', 'fwrite', 'fputs',
  'wp_mail', 'wp_create_user', 'wp_set_auth_cookie', 'wp_set_current_user', 'wp_signon', 'wp_logout',
  'wp_schedule_event', 'wp_schedule_single_event', 'wp_unschedule_event', 'wp_clear_scheduled_hook',
  'wp_set_object_terms', 'wp_set_post_terms', 'wp_handle_upload', 'wp_upload_bits', 'move_uploaded_file',
]);
const WRITE_PREFIX = /^wp_(insert|update|delete)_/;
const WPDB_WRITE_METHODS = new Set(['insert', 'update', 'delete', 'replace', 'query']);

const OUTBOUND_FUNCTIONS = new Set([
  'wp_remote_get', 'wp_remote_post', 'wp_remote_request', 'wp_remote_head',
  'wp_safe_remote_get', 'wp_safe_remote_post', 'wp_safe_remote_request', 'wp_safe_remote_head',
  'download_url', 'curl_init', 'curl_exec', 'fsockopen', 'media_sideload_image',
]);

const AUTH_FUNCTIONS = new Set([
  'current_user_can', 'is_user_logged_in', 'wp_verify_nonce', 'hash_equals', 'wp_check_password', 'wp_signon',
  'get_current_user_id', 'check_admin_referer', 'check_ajax_referer',
]);
const AUTH_METHOD = /verify|validat|auth|signature|token|guard|permission|can_|handle_registration/i;

const NONCE_FUNCTIONS = new Set(['check_admin_referer', 'check_ajax_referer', 'wp_verify_nonce']);
const NONCE_NAME = /nonce|referer|csrf|sanity_check/i;

/**
 * @param {{kind:string, name:string|null, wpdb:boolean}} call kind is the receiver kind of the call
 * @returns {{write:boolean, outbound:boolean, auth:boolean, nonce:boolean}}
 */
export function labelCall({ kind, name, wpdb }) {
  const lower = String(name || '').toLowerCase();
  const isFunction = kind === 'func';
  const isMethodLike = !isFunction && kind !== 'new';
  const wpdbWrite = wpdb && WPDB_WRITE_METHODS.has(lower);
  const write = (isFunction && (WRITE_FUNCTIONS.has(lower) || WRITE_PREFIX.test(lower))) || wpdbWrite;
  const outbound = isFunction && OUTBOUND_FUNCTIONS.has(lower);
  const auth = (isFunction && AUTH_FUNCTIONS.has(lower)) || (isMethodLike && AUTH_METHOD.test(lower));
  const nonce = (isFunction && NONCE_FUNCTIONS.has(lower)) || (lower !== '' && NONCE_NAME.test(lower));
  return { write: Boolean(write), outbound, auth, nonce };
}

export const HOOK_MAP_PREFIX = /^(wp_ajax_nopriv_|wp_ajax_|admin_post_nopriv_|admin_post_)/;
