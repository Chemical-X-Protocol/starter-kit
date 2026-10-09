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

export const sanitizeText = (text) => {
  const isString = typeof text === 'string';
  if (!isString) return '';

  const masked = maskSensitiveTokens(text);
  return normalizeHomePath(masked);
};

export const sanitizeStackTrace = (stack) => {
  const hasStack = Boolean(stack && typeof stack === 'string');
  if (!hasStack) return '';

  return sanitizeText(stack);
};
