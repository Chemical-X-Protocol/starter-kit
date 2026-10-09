/**
 * Chemical X UI request gate.
 * Every request needs the per-launch token (header, ?token= or cookie), a
 * loopback or explicitly bound Host (DNS rebinding), a same-origin Origin when
 * one is sent, and a JSON Content-Type on POST (no CORS simple requests).
 */
import crypto from 'node:crypto';
import { buildAllowedHosts } from './ui-auth-hosts.js';

export { resolveUiUrlHost, isWildcardHost } from './ui-auth-hosts.js';

export const UI_TOKEN_HEADER = 'x-chemx-token';
export const DEFAULT_UI_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const isLoopbackHost = (host = '') => LOOPBACK_HOSTS.has(String(host).toLowerCase());

export const createUiAuth = (options = {}) => ({
  token: options.token || crypto.randomBytes(24).toString('base64url'),
  bindHost: options.bindHost || DEFAULT_UI_HOST,
  allowedHosts: buildAllowedHosts({ ...options, bindHost: options.bindHost || DEFAULT_UI_HOST }),
  cookieName: 'chemx_ui_token'
});

const hostnameOf = (hostHeader = '') => {
  const isBracketed = hostHeader.startsWith('[');
  if (isBracketed) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0];
};

const readCookie = (req, name) => {
  const pairs = String(req.headers.cookie || '').split(';').map((part) => part.trim().split('='));
  const match = pairs.find(([key]) => key === name);
  return match ? decodeURIComponent(match.slice(1).join('=')) : '';
};

const isSameToken = (candidate, token) => {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const isAllowedHostHeader = (req, auth) => {
  const hostname = hostnameOf(String(req.headers.host || '')).toLowerCase();
  const allowedHosts = auth.allowedHosts || buildAllowedHosts({ bindHost: auth.bindHost });
  return allowedHosts.has(hostname);
};

const isSameOriginRequest = (req) => {
  const origin = req.headers.origin;
  const isCrossSiteFetch = req.headers['sec-fetch-site'] === 'cross-site';
  if (isCrossSiteFetch) return false;
  const hasOrigin = typeof origin === 'string' && origin.length > 0;
  if (!hasOrigin) return true;
  return origin === `http://${req.headers.host}`;
};

const isJsonContentType = (req) => /^application\/json\b/i.test(String(req.headers['content-type'] || ''));

const deny = (status, error) => ({ allowed: false, status, error });

/**
 * Decides whether a request may proceed. Returns { allowed, setCookie } or
 * { allowed: false, status, error }.
 */
export const checkUiRequest = (req, auth, url) => {
  if (!isAllowedHostHeader(req, auth)) return deny(403, 'Host not allowed');
  if (!isSameOriginRequest(req)) return deny(403, 'Cross-origin request refused');
  const queryToken = url.searchParams.get('token');
  const headerToken = req.headers[UI_TOKEN_HEADER];
  const cookieToken = readCookie(req, auth.cookieName);
  const hasValidQueryToken = isSameToken(queryToken, auth.token);
  const isAuthorized = hasValidQueryToken || isSameToken(headerToken, auth.token) || isSameToken(cookieToken, auth.token);
  if (!isAuthorized) return deny(401, 'Missing or invalid chemx UI token. Open the URL printed by `chemx ui`.');
  const isPost = req.method === 'POST';
  const isNonJsonPost = isPost && !isJsonContentType(req);
  if (isNonJsonPost) return deny(415, 'POST requires Content-Type: application/json');
  // Accepted risk: cookies are not port-scoped, so other servers on the same
  // loopback host receive this HttpOnly cookie. It only authorizes this
  // launch of the UI (the token changes every run).
  const setCookie = hasValidQueryToken
    ? `${auth.cookieName}=${encodeURIComponent(auth.token)}; HttpOnly; SameSite=Strict; Path=/`
    : null;
  return { allowed: true, setCookie };
};

/** fetch() bound to a running UI server: adds the token header. */
export const createUiFetch = (token) => (url, init = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers || {}), [UI_TOKEN_HEADER]: token } });
