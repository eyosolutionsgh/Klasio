'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Button, type ActionState } from './Button';

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
  /**
   * Decorative leading icon — an envelope, a padlock. Purely a scanning aid: the label already
   * says what the field is, so this carries `aria-hidden` and adds nothing for a screen reader.
   */
  icon?: ReactNode;
};

export function AuthField({ label, revealable, icon, className = '', ...input }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const type = revealable ? (shown ? 'text' : 'password') : input.type;

  return (
    <div className="group relative px-4 py-2.5 transition-colors focus-within:bg-brand-mist/25">
      <div className="flex items-center gap-3">
        {icon && (
          // Tracks the focus ring so the whole row reads as one active control, rather than an
          // icon sitting inertly beside a field that has clearly woken up.
          <span className="shrink-0 text-oat/70 transition-colors group-focus-within:text-brand">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
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
        </div>
      </div>
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

/**
 * The page's single primary action, in the sign-in doors' accent.
 *
 * A thin wrapper over the shared `Button` so the doors cannot drift from the rest of the app:
 * the stacked-label width, the pending/settled icons and the live region all come from there.
 * `busy` is kept because most callers only ever have two states; pass `state` instead to get the
 * full "Sending… → Sent!" cycle from `useAsyncAction`.
 */
export function AuthButton({
  busy,
  state,
  children,
  busyLabel,
  doneLabel,
  icon,
}: {
  busy?: boolean;
  state?: ActionState;
  children: string;
  busyLabel?: string;
  doneLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Button
      variant="accent"
      className="px-10"
      state={state ?? (busy ? 'pending' : 'idle')}
      pendingLabel={busyLabel}
      doneLabel={doneLabel}
      icon={icon}
    >
      {children}
    </Button>
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
