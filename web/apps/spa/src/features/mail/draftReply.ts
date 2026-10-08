/**
 * Remembers which message a saved draft replies to.
 *
 * A saved draft stores the `In-Reply-To`/`References` headers, but the gateway does not hand the
 * replied-to message id back on `GET /drafts/{id}`. Without that id a reopened reply draft would
 * be sent without the `\Answered` flag on the original. The draft id changes on every save, so the
 * map is re-keyed after each save. This is a per-browser convenience (localStorage may be empty
 * or unavailable): a lost entry only costs the flag, never the message.
 */
const STORAGE_KEY = 'mgate.mail.draftReplies';
const MAX_ENTRIES = 50;

type DraftReplies = Record<string, string>;

function read(): DraftReplies {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: DraftReplies = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function write(map: DraftReplies): void {
  try {
    // Oldest entries first (insertion order): keep the newest MAX_ENTRIES.
    const keys = Object.keys(map);
    const trimmed = keys.length > MAX_ENTRIES ? keys.slice(keys.length - MAX_ENTRIES) : keys;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(trimmed.map((k) => [k, map[k]]))),
    );
  } catch {
    // Storage is unavailable (private window, quota): the reply link is simply not remembered.
  }
}

/** Records `replyToId` for the freshly saved `draftId` and drops the superseded draft id. */
export function rememberDraftReply(draftId: string, replyToId: string, previousId?: string): void {
  const map = read();
  if (previousId) delete map[previousId];
  delete map[draftId];
  map[draftId] = replyToId;
  write(map);
}

export function recallDraftReply(draftId: string): string | undefined {
  return read()[draftId];
}

export function forgetDraftReply(draftId: string | undefined): void {
  if (!draftId) return;
  const map = read();
  if (!(draftId in map)) return;
  delete map[draftId];
  write(map);
}
