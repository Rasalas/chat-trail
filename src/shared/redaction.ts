type RedactionReplacement = string | ((match: string) => string);

const REDACTION_RULES: Array<[RegExp, RedactionReplacement]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]"],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){3,8}\b/g, redactIban],
  // Plain, or grouped like printed cards (4-4-4-4[-3], Amex 4-6-5) with one separator, so a date
  // followed by a phone number is not read as a card.
  [/\b(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{4}(?:\1\d{3})?|\d{4}([ -])\d{6}\2\d{5})\b/g, redactCardNumber],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-aws-key]"],
  [/\b(?:sk|rk|pk|xox[baprs]|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]{8,}/gi, "$1=[redacted-secret]"],
  // A separator must be followed by a digit, so "a / b" or "a, b" are two candidates, not one.
  [/(?<=^|[\s(])\(?\+?\d(?:\d|[ ./-](?=\d)|\) ?(?=\d)| ?\((?=\d))*\b/g, redactPhone]
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

// The phone candidate also catches dates, IPs, versions, IDs and runs of several numbers. Redact the
// longest phone-like prefix (in whole space-separated groups), then continue after it.
function redactPhone(match: string): string {
  // "(+49 …)" matches without its closing paren; keep the opening one in the text.
  const open = match.startsWith("(") && !match.includes(")") ? "(" : "";
  return open + redactPhoneGroups(match.slice(open.length).split(" "));
}

function redactPhoneGroups(groups: string[]): string {
  if (groups.length === 0) return "";
  for (let take = groups.length; take >= 1; take -= 1) {
    if (!looksLikePhone(groups.slice(0, take).join(" "))) continue;
    const rest = redactPhoneGroups(groups.slice(take));
    return rest ? `[redacted-phone] ${rest}` : "[redacted-phone]";
  }
  const rest = redactPhoneGroups(groups.slice(1));
  return rest ? `${groups[0]} ${rest}` : groups[0];
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return false;
  // Unseparated runs are usually IDs or timestamps; only a "+" or trunk "0" marks them as phones.
  if (/^\d+$/.test(value) && !value.startsWith("0")) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(value)) return false;
  if (/^\d{4}\s*-\s*\d{4}$/.test(value)) return false;
  if (value.includes(".") && !/^\d{3}\.\d{3}\.\d{4}$/.test(value)) return false;
  if (/^[1-9]\d{0,2}( \d{3})+$/.test(value)) return false;
  // Phone groups after the first have 2+ digits ("+49 (0) 30 …" aside); "1 2 3 4 5 6 7" is a list.
  return !value.replace("(0)", "").split(/[ ./()-]+/).filter(Boolean).slice(1).some((group) => group.length === 1);
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
