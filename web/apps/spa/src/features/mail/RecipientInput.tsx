import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { lastToken, replaceLastToken } from './addresses';
import { mailApi } from './mailApi';
import type { Contact } from './types';

const MIN_CHARS = 2;
const MAX_CHARS = 64; // server limit for autocomplete queries
const DEBOUNCE_MS = 200;

export interface RecipientInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
}

/** Comma-separated recipient field with address-book autocomplete for the entry being typed. */
export function RecipientInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus,
}: RecipientInputProps) {
  const token = lastToken(value);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (token.length < MIN_CHARS) return;
    const query = token.slice(0, MAX_CHARS);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      mailApi
        .autocomplete(query, controller.signal)
        .then((data) => {
          setSuggestions(Array.isArray(data) ? data.slice(0, 10) : []);
          setDismissed(false);
        })
        .catch(() => {
          // Autocomplete is a convenience: a failure just means no suggestions.
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token]);

  const visible = !dismissed && token.length >= MIN_CHARS && suggestions.length > 0;

  return (
    <div className="relative flex flex-1 items-center">
      <input
        type="text"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDismissed(true);
        }}
        className="text-mg-text placeholder:text-mg-text-muted flex-1 bg-transparent focus:outline-none"
      />
      {visible ? (
        <ul
          role="listbox"
          className="border-mg-border bg-mg-surface absolute top-full right-0 left-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border py-1 shadow-xl"
        >
          {suggestions.map((c) => (
            <li
              key={c.id}
              role="option"
              aria-selected="false"
              className="text-mg-text hover:bg-mg-surface-subtle flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition-colors"
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                onChange(replaceLastToken(value, c.email));
                setDismissed(true);
              }}
            >
              <div className="bg-mg-primary/10 text-mg-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
                {c.name ? c.name.charAt(0).toUpperCase() : <User className="h-3 w-3" />}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{c.name}</span>
                <span className="text-mg-text-muted truncate">{c.email}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
