/**
 * Extracts a human-readable message from a failed `/api/v1/*` response.
 *
 * The API wraps every error as `{"error": {"code", "message", "details"?, "request_id"?}}`.
 * `message` is a generic Russian sentence ("Ошибка валидации данных."); for `422
 * validation_failed` and `409 conflict` the specific cause is in `details.reason`, so that wins
 * when present. Falls back to `message`, then to `fallback` (non-JSON bodies, proxies, 5xx).
 */
export function messageFromApiErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const { details, message } = error as { details?: unknown; message?: unknown };
      if (details && typeof details === 'object') {
        const reason = (details as { reason?: unknown }).reason;
        if (typeof reason === 'string' && reason.trim()) return reason;
      }
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return fallback;
}

/** Reads the JSON error body of a non-OK response and returns {@link messageFromApiErrorBody}. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return messageFromApiErrorBody(body, fallback);
}
