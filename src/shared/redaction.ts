type RedactionReplacement = string | ((match: string) => string);

const REDACTION_RULES: Array<[RegExp, RedactionReplacement]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]"],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){3,8}\b/g, redactIban],
  [/\b(?:\d[ -]?){11,18}\d\b/g, redactCardNumber],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-aws-key]"],
  [/\b(?:sk|rk|pk|xox[baprs]|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]{8,}/gi, "$1=[redacted-secret]"],
  [/(?<=^|[\s(])\+?\d[\d .()/-]{7,}\d\b/g, "[redacted-phone]"]
];

export function redactText(value: string): string {
  return REDACTION_RULES.reduce((text, [pattern, replacement]) => {
    if (typeof replacement === "function") {
      return text.replace(pattern, (match: string) => replacement(match));
    }
    return text.replace(pattern, replacement);
  }, value);
}

function redactIban(match: string): string {
  const compact = match.replace(/ /g, "");
  return compact.length >= 15 && compact.length <= 34 ? "[redacted-iban]" : match;
}

function redactCardNumber(match: string): string {
  const digits = match.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? "[redacted-card]" : match;
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
