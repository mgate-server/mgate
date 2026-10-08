/**
 * Minimal parser for the `Authentication-Results` header (RFC 8601), just enough to drive the
 * SPF/DKIM/DMARC badge in the message reader (SPF/DKIM indicator for the incoming message).
 * Not a full grammar parser: it scans for `<mechanism>=<result>` tokens rather than parsing
 * `resinfo`/comment structure, which is sufficient for every MTA (Rspamd included) we've seen in
 * practice. TODO(S5): revisit if a header is found where this heuristic misattributes a result
 * (e.g. a comment happens to contain "dkim=" text) — the real Rspamd output should be checked
 * against this once the policy service is wired up.
 */
export type AuthMechanism = 'spf' | 'dkim' | 'dmarc';

export type AuthResultValue =
  'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy';

const KNOWN_VALUES: ReadonlySet<string> = new Set([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
  'policy',
]);

export interface ParsedAuthResults {
  spf: AuthResultValue | null;
  dkim: AuthResultValue | null;
  dmarc: AuthResultValue | null;
}

function normalizeValue(raw: string): AuthResultValue {
  const lower = raw.toLowerCase();
  return (KNOWN_VALUES.has(lower) ? lower : 'neutral') as AuthResultValue;
}

const TOKEN_RE = /\b(spf|dkim|dmarc)\s*=\s*([a-zA-Z]+)/g;

export function parseAuthenticationResults(
  headerValue: string | null | undefined,
): ParsedAuthResults {
  const result: ParsedAuthResults = { spf: null, dkim: null, dmarc: null };
  if (!headerValue) return result;

  const seen: Record<AuthMechanism, AuthResultValue[]> = { spf: [], dkim: [], dmarc: [] };
  for (const match of headerValue.matchAll(TOKEN_RE)) {
    const mechanism = match[1]?.toLowerCase() as AuthMechanism;
    const value = match[2];
    if (mechanism && value) seen[mechanism].push(normalizeValue(value));
  }

  (Object.keys(seen) as AuthMechanism[]).forEach((mechanism) => {
    const values = seen[mechanism];
    if (values.length === 0) return;
    // A message can carry multiple DKIM signatures; treat it as passing if any one does.
    result[mechanism] = values.includes('pass') ? 'pass' : (values[0] ?? null);
  });

  return result;
}
