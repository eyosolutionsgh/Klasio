'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * A field whose label lives inside the box, above the value.
 *
 * Grouped rather than free-standing: `AuthFieldGroup` draws one border around the set and a hair
 * rule between them, so email and password read as a single block. Each row lights up on
 * focus-within, which is the only cue that survives having no border of its own.
 */
export function AuthFieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-mist bg-white divide-y divide-mist overflow-hidden">
      {children}
    </div>
  );
}

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Adds the reveal toggle. Only for real passwords — never for a one-time code. */
  revealable?: boolean;
};

export function AuthField({ label, revealable, className = '', ...input }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const type = revealable ? (shown ? 'text' : 'password') : input.type;

  return (
    <div className="relative px-4 py-2.5 transition-colors focus-within:bg-brand-mist/25">
      <label
        htmlFor={id}
        className="block text-[11px] uppercase tracking-wider text-oat pointer-events-none"
      >
        {label}
      </label>
      <input
        {...input}
        id={id}
        type={type}
        className={`w-full bg-transparent border-0 p-0 pt-1 pb-1.5 text-[15px] text-ink outline-none placeholder:text-oat/50 ${revealable ? 'pr-10' : ''} ${className}`}
      />
      {revealable && (
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          // The state, not the icon: a screen reader user cannot see which eye is drawn.
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute right-2 bottom-1.5 grid place-items-center w-10 h-10 text-oat hover:text-brand transition rounded-lg"
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      )}
    </div>
  );
}

function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.2" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M9.9 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17 17 0 0 1-3.3 4M6.2 6.6A17 17 0 0 0 1.5 12S5.5 19 12 19a9.9 9.9 0 0 0 4.2-.9"
        strokeWidth="1.6"
      />
      <path d="M3 3l18 18" strokeWidth="1.6" />
    </svg>
  );
}

/** The page's single primary action. Gold rather than the portal's green — see the note below. */
export function AuthButton({
  busy,
  children,
  busyLabel,
}: {
  busy?: boolean;
  children: ReactNode;
  busyLabel?: string;
}) {
  return (
    <button
      disabled={busy}
      /**
       * Dark text on gold, not white.
       *
       * The reference this follows uses a bright accent button with white lettering; at EYO's
       * gold that is roughly 2.6:1 and simply unreadable in sunlight on a phone. Ink on the same
       * gold is about 7:1, so the button keeps the accent the design is built around and stays
       * legible.
       */
      className="min-h-11 rounded-lg px-10 text-sm font-semibold uppercase tracking-wider text-ink bg-gradient-to-r from-[#e2bb55] to-gold hover:from-gold hover:to-[#b0831f] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_6px_16px_-6px_rgba(201,152,47,0.8)]"
    >
      {busy ? (busyLabel ?? 'Please wait…') : children}
    </button>
  );
}

/** Consistent error presentation across the three sign-in doors. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-5 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
    >
      {children}
    </p>
  );
}
