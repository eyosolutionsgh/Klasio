'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertIcon, CheckIcon, SpinnerIcon } from './icons';
import { deriveLabels } from '@/lib/action-labels';

export type ActionState = 'idle' | 'pending' | 'done' | 'failed';

/** How long the outcome stays on the button before it offers itself again. */
const RESET_MS = 2000;

/**
 * Drive a button through pending → done/failed → idle.
 *
 * `run` is safe to hand straight to `onSubmit`: it calls `preventDefault` itself, so a form does
 * not need its own wrapper. Errors are swallowed *for the button's purposes* only — `run` still
 * rejects, so a caller that wants to show a message can await it.
 */
export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown> | unknown,
  resetMs = RESET_MS,
) {
  const [state, setState] = useState<ActionState>('idle');
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const settle = useCallback(
    (next: 'done' | 'failed') => {
      if (!alive.current) return;
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // The component may have gone away while the outcome was on screen.
        if (alive.current) setState('idle');
      }, resetMs);
    },
    [resetMs],
  );

  const run = useCallback(
    async (...args: A) => {
      const first = args[0] as { preventDefault?: () => void } | undefined;
      if (first && typeof first.preventDefault === 'function') first.preventDefault();

      // Ignore a second click while the first is still in flight, so a double-tap on a slow
      // connection cannot submit twice even where the button is not the only trigger.
      if (state === 'pending') return;
      setState('pending');
      try {
        const result = await fn(...args);
        settle('done');
        return result;
      } catch (err) {
        settle('failed');
        throw err;
      }
    },
    [fn, settle, state],
  );

  return { state, run, reset: () => setState('idle') };
}

const VARIANTS = {
  primary: 'bg-brand text-paper hover:bg-brand-deep',
  secondary: 'border border-mist bg-white text-ink hover:bg-parchment',
  danger: 'bg-danger text-paper hover:brightness-95',
  ghost: 'text-oat hover:text-brand hover:bg-parchment/60',
  /**
   * The sign-in doors' single primary action.
   *
   * Ink on teal rather than white on teal: the brighter teal the design is built around is about
   * 3.3:1 against paper-white and unreadable in sunlight on a phone, while ink on the same teal is
   * 4.7:1 and keeps the accent. Both gradient stops were checked, and the hover *brightens* so
   * contrast climbs rather than dips under the cursor.
   */
  accent:
    'text-ink bg-gradient-to-r from-[#00b3b9] to-gold-bright hover:from-[#00c2c8] hover:to-[#00a7ad] uppercase tracking-wider font-semibold shadow-[0_6px_16px_-6px_rgba(0,151,156,0.8)]',
} as const;

const SIZES = {
  sm: 'min-h-9 px-3 text-[13px] gap-1.5',
  md: 'min-h-11 px-5 text-sm gap-2',
} as const;

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: string;
  /** Leading icon for the idle state. Swapped for a spinner/tick/alert as the action runs. */
  icon?: ReactNode;
  state?: ActionState;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  pendingLabel?: string;
  doneLabel?: string;
  failedLabel?: string;
};

/**
 * The app's button.
 *
 * Every label the button can show is rendered into the same grid cell, with the inactive ones
 * merely `invisible`. That is what stops "Save" → "Saving…" → "Saved!" from resizing the control
 * and shoving the rest of the row about mid-click; the cell is always as wide as the longest
 * state, from the first paint.
 *
 * The outcome is never carried by colour alone — a tick and the word "Saved!" arrive together, so
 * the result survives both colour blindness and a screen reader, which is also why the live region
 * below announces it.
 */
export function Button({
  children,
  icon,
  state = 'idle',
  variant = 'primary',
  size = 'md',
  pendingLabel,
  doneLabel,
  failedLabel,
  className = '',
  disabled,
  ...rest
}: Props) {
  const derived = deriveLabels(children);
  const labels: Record<ActionState, string> = {
    idle: children,
    pending: pendingLabel ?? derived.pending,
    done: doneLabel ?? derived.done,
    failed: failedLabel ?? derived.failed,
  };
  const icons: Record<ActionState, ReactNode> = {
    idle: icon,
    // `motion-reduce` stops the spin for anyone who has asked the OS for less movement; the
    // label already says "Saving…", so nothing is lost by holding it still.
    pending: <SpinnerIcon className="animate-spin motion-reduce:animate-none" />,
    done: <CheckIcon />,
    failed: <AlertIcon />,
  };

  const tone =
    state === 'done'
      ? 'bg-leaf text-paper'
      : state === 'failed'
        ? 'bg-danger text-paper'
        : VARIANTS[variant];

  // Character count is a proxy for rendered width, which is close enough here: the four labels
  // share a font and each carries an icon of identical size, so the longest string is reliably
  // the widest state.
  const widest = Object.values(labels).reduce((a, b) => (b.length > a.length ? b : a));
  const gap = SIZES[size].split(' ').pop();

  return (
    <>
      <button
        {...rest}
        disabled={disabled || state === 'pending'}
        aria-busy={state === 'pending'}
        className={`inline-grid place-items-center rounded-lg font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${SIZES[size]} ${tone} ${className}`}
      >
        {/*
          Only the live label is real content, so the button's accessible name is exactly what it
          currently reads — "Log in", never "Log inSigning in…Signed in!Didn't work".

          An earlier version stacked all four labels and leaned on aria-hidden plus
          visibility:hidden to keep three of them out of the name. That is correct by the letter of
          the spec and still confused a real consumer of the tree, which is a bad trade for a
          button's name. One sizer below does the same job with nothing to misread.
        */}
        <span
          className={`col-start-1 row-start-1 inline-flex items-center whitespace-nowrap ${gap}`}
        >
          {icons[state]}
          {labels[state]}
        </span>
        <span
          aria-hidden
          // Never shown or read: it exists purely to hold the cell open at the width of the
          // longest state, so the label changes cannot resize the control mid-press.
          className={`col-start-1 row-start-1 inline-flex items-center whitespace-nowrap invisible pointer-events-none ${gap}`}
        >
          {icons.idle}
          {widest}
        </span>
      </button>
      {/*
        The outcome, for a screen reader. Kept out of the button itself: changing a button's own
        accessible name mid-press is announced inconsistently across readers, whereas a polite
        live region is read once, after the press, which is what a user actually wants to hear.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'pending' || state === 'idle' ? '' : labels[state]}
      </span>
    </>
  );
}
