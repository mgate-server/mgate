/**
 * Address helpers for the composer. The API accepts plain `local@domain` addresses, so display
 * names are stripped on the way out (`"Doe, John" <j@x.org>` -> `j@x.org`).
 */

const EMAIL_RE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

interface SplitResult {
  /** Complete entries (terminated by a separator). */
  done: string[];
  /** What follows the last separator: the entry being typed. */
  tail: string;
}

function splitWithTail(input: string): SplitResult {
  const done: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '<') inAngle = true;
    else if (!inQuotes && ch === '>') inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuotes && !inAngle) {
      if (current.trim()) done.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  return { done, tail: current };
}

/** Splits a recipient field on `,` / `;` outside quotes and angle brackets. */
export function splitAddressList(input: string): string[] {
  const { done, tail } = splitWithTail(input);
  return tail.trim() ? [...done, tail.trim()] : done;
}

/** `Name <a@b>` -> `a@b`; a bare address is returned unchanged; anything else -> trimmed input. */
export function extractEmail(entry: string): string {
  const angle = entry.match(/<([^<>]+)>\s*$/);
  return (angle?.[1] ?? entry).trim();
}

export interface ParsedRecipients {
  addresses: string[];
  invalid: string[];
}

/** Parses a recipient field into de-duplicated plain addresses plus the entries that are not one. */
export function parseRecipients(input: string): ParsedRecipients {
  const seen = new Set<string>();
  const addresses: string[] = [];
  const invalid: string[] = [];
  for (const entry of splitAddressList(input)) {
    const email = extractEmail(entry);
    if (!isPlausibleEmail(email)) {
      invalid.push(entry);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(email);
  }
  return { addresses, invalid };
}

/** The token being typed: everything after the last separator. */
export function lastToken(input: string): string {
  return splitWithTail(input).tail.trim();
}

/** Replaces the token being typed with `email`, keeping what was already entered. */
export function replaceLastToken(input: string, email: string): string {
  const { done } = splitWithTail(input);
  return [...done, email].join(', ') + ', ';
}
