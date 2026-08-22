const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]"],
  [/(?<=^|[\s(])\+?\d[\d .()/-]{7,}\d\b/g, "[redacted-phone]"],
  [/\b(?:sk|rk|pk|xox[baprs]|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]{8,}/gi, "$1=[redacted-secret]"]
];

export function redactText(value: string): string {
  return REDACTION_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
