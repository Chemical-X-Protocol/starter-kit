// Network policy: the one place that decides whether chemx may talk to the network,
// and which hosts an environment override may point it at.
// Network only happens inside explicit license, download and share flows.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FALSY_FLAG_VALUES = new Set(['', '0', 'false', 'no', 'off']);

const isFlagSet = (value) => {
  const hasValue = typeof value === 'string';
  if (!hasValue) return false;
  return !FALSY_FLAG_VALUES.has(value.trim().toLowerCase());
};

// CHEMX_OFFLINE is ours; DO_NOT_TRACK is the cross-tool convention (consoledonottrack.com).
export const resolveOfflineReason = (env = process.env) => {
  if (isFlagSet(env.CHEMX_OFFLINE)) return 'CHEMX_OFFLINE';
  if (isFlagSet(env.DO_NOT_TRACK)) return 'DO_NOT_TRACK';
  return null;
};

export const isOfflineMode = (env = process.env) => resolveOfflineReason(env) !== null;

export const describeOffline = (action, env = process.env) => {
  const reason = resolveOfflineReason(env) || 'CHEMX_OFFLINE';
  return `Offline mode (${reason}=${env[reason] ?? '1'}): ${action} skipped. No network request was made. Unset ${reason} to allow it.`;
};

const parseUrl = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

export const isAllowedOverrideUrl = (raw) => {
  const parsed = parseUrl(raw);
  if (!parsed) return false;
  const isHttps = parsed.protocol === 'https:';
  if (isHttps) return true;
  const isPlainHttp = parsed.protocol === 'http:';
  return isPlainHttp && LOOPBACK_HOSTS.has(parsed.hostname);
};

// Resolves an endpoint from an env override or the built-in default.
// An override that is not https (or plain http to loopback) is refused, never silently replaced.
export const resolveEndpoint = (envName, defaultUrl, env = process.env) => {
  const rawOverride = typeof env[envName] === 'string' ? env[envName].trim() : '';
  const hasOverride = rawOverride.length > 0;
  if (!hasOverride) {
    return { url: defaultUrl, isOverride: false, envName, error: null };
  }
  const isAllowed = isAllowedOverrideUrl(rawOverride);
  if (!isAllowed) {
    const error = `${envName}=${rawOverride} refused: overrides must use https:// (plain http is allowed only for localhost and 127.0.0.1).`;
    return { url: null, isOverride: true, envName, error };
  }
  return { url: rawOverride.replace(/\/+$/, ''), isOverride: true, envName, error: null };
};

export const describeOverride = (endpoint) => {
  const parsed = parseUrl(endpoint.url);
  const host = parsed ? parsed.host : endpoint.url;
  return `Using ${endpoint.envName} override: ${host}`;
};

// Prints the overriding host once per use so a redirected license key is never silent.
export const announceOverride = (endpoint, stream = process.stderr) => {
  const shouldAnnounce = Boolean(endpoint && endpoint.isOverride && endpoint.url);
  if (!shouldAnnounce) return;
  stream.write(`${describeOverride(endpoint)}\n`);
};
