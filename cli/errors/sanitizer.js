import os from 'node:os';

const TOKEN_PATTERNS = [
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /npm_[a-zA-Z0-9]{20,}/g,
  /bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi,
  /(?:api[_-]?key|license[_-]?key|secret|token|password)[=:]\s*["']?([a-zA-Z0-9_\-\.]{8,})["']?/gi
];

// License keys: the value after --license (any format, unless it is the next flag) and bare CX-XXXX-XXXX-XXXX keys.
const LICENSE_FLAG_PATTERN = /(--license(?:=|\s+))(?!-)["']?[^\s"']+["']?/g;
const LICENSE_KEY_PATTERN = /\bCX(?:-[A-Z0-9]{4}){3,}\b/gi;

export const maskLicenseKeys = (text) => {
  const isInputString = typeof text === 'string';
  if (!isInputString) return '';
  return text.replace(LICENSE_FLAG_PATTERN, '$1[REDACTED_LICENSE]').replace(LICENSE_KEY_PATTERN, '[REDACTED_LICENSE]');
};

export const maskSensitiveTokens = (text) => {
  const isInputString = typeof text === 'string';
  if (!isInputString) return '';

  let sanitized = maskLicenseKeys(text);
  for (const pattern of TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const isBearer = match.toLowerCase().startsWith('bearer');
      if (isBearer) return 'Bearer [REDACTED]';
      return '[REDACTED_SECRET]';
    });
  }
  return sanitized;
};

export const normalizeHomePath = (text) => {
  const isInputString = typeof text === 'string';
  if (!isInputString) return '';

  const homeDir = os.homedir();
  const hasHomeDir = Boolean(homeDir && homeDir.length > 0);
  if (!hasHomeDir) return text;

  return text.split(homeDir).join('~');
};

// user@host.tld. Scoped packages (@vue/x) and versions (pkg@1.2.3) have no local part or TLD, so they stay.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export const maskEmails = (text) => {
  const isInputString = typeof text === 'string';
  if (!isInputString) return '';
  return text.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
};

// The one sanitizer for every report string (title, body, context, stack, CLI output):
// license keys, tokens, emails, then the home directory.
export const sanitizeText = (text) => {
  const isString = typeof text === 'string';
  if (!isString) return '';

  const masked = maskEmails(maskSensitiveTokens(text));
  return normalizeHomePath(masked);
};

// Structured caller data (report.context): mask every string, and every non-boolean primitive
// at any depth beneath a secret-named key (so { license: { key } } is masked too).
const SECRET_KEY_NAME = /api[_-]?key|license|secret|token|password|passwd|credential|authorization/i;

const isMaskablePrimitive = (value) => value !== null && value !== undefined && typeof value !== 'object' && typeof value !== 'boolean';

export const sanitizeValue = (value, seen = new WeakSet(), isUnderSecret = false) => {
  const isSecretValue = isUnderSecret && isMaskablePrimitive(value);
  if (isSecretValue) return '[REDACTED_SECRET]';
  if (typeof value === 'string') return sanitizeText(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value); // ancestors only, so a shared (non-circular) reference is still rendered
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen, isUnderSecret));
    const entries = Object.entries(value).map(([key, item]) => {
      const isSecret = isUnderSecret || SECRET_KEY_NAME.test(key);
      return [sanitizeText(key), sanitizeValue(item, seen, isSecret)];
    });
    return Object.fromEntries(entries);
  } finally {
    seen.delete(value);
  }
};

export const sanitizeStackTrace = (stack) => {
  const hasStack = Boolean(stack && typeof stack === 'string');
  if (!hasStack) return '';

  return sanitizeText(stack);
};
