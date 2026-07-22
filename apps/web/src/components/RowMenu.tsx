'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The actions for one row of a table, behind one button.
 *
 * Rows used to carry their controls in the open — a staff row was four of them, "Access · Make
 * proprietor · Reset password · Deactivate", repeated down every row. Two problems with that: the
 * table is wider than the screen before the useful columns have had their space, and a wall of
 * repeated buttons gives the destructive one exactly the same weight as the routine one. A menu
 * costs a click and gives the row back its width.
 *
 * Three things this handles that a row of buttons did not:
 *
 * - **Asking before something irreversible, in the page.** `confirm` on an action turns selecting
 *   it into a second step inside the menu. Native `window.confirm` is suppressed in embedded
 *   browsers and a suppressed confirm returns *false*, so every dialog-guarded action silently did
 *   nothing there — the button looked live and never fired. This cannot be suppressed.
 * - **Narrating the work.** Selecting an item keeps the menu open and runs the label through
 *   Save → Saving… → Saved, then closes. Moving the actions into a menu must not lose what the
 *   shared Button gave them.
 * - **Escaping the scroll container.** Tables live in `overflow-x-auto` cards, which clip a child
 *   panel whatever its z-index, so the panel is portalled to the body and positioned from the
 *   trigger's viewport rect — the same reason `Combobox` does it.
 */

export interface RowAction {
  label: string;
  /** The work. Held open while it runs so the label can narrate it. */
  onSelect?: () => void | Promise<unknown>;
  /** A navigation or download instead of an action — rendered as a link, closes on click. */
  href?: string;
  download?: boolean;
  icon?: React.ReactNode;
  /** Destructive: coloured, and placed under a divider by the caller's ordering. */
  danger?: boolean;
  /** Ask first. The string is the question, e.g. "Remove Ama from this route?". */
  confirm?: string;
  /** Wording for the confirmation's go-ahead. Defaults to the action's own label. */
  confirmLabel?: string;
  pendingLabel?: string;
  doneLabel?: string;
  failedLabel?: string;
  disabled?: boolean;
  /** Omitted entirely rather than shown greyed — an action nobody may take is not information. */
  hidden?: boolean;
}

/** Enough room to be worth opening downwards; below this the menu flips above the trigger. */
const PREFERRED = 220;

export default function RowMenu({
  actions,
  label = 'this row',
  align = 'right',
}: {
  actions: RowAction[];
  /** Names the row for a screen reader: "Actions for Ama Mensah". */
  label?: string;
  align?: 'left' | 'right';
}) {
  const id = useId();
  const items = actions.filter((a) => !a.hidden);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<RowAction | null>(null);
  const [busy, setBusy] = useState<{ label: string; state: 'pending' | 'done' | 'failed' } | null>(
    null,
  );
  const [rect, setRect] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = window.innerHeight - b.bottom - gap - margin;
    const above = b.top - gap - margin;
    const flip = below < PREFERRED && above > below;
    // Right-aligned to the trigger by default: the menu belongs to the row's right edge, and a
    // left-aligned panel on the last column would hang off the screen.
    const width = 224;
    const left = align === 'right' ? Math.max(margin, b.right - width) : b.left;
    setRect({
      left,
      ...(flip ? { bottom: window.innerHeight - b.top + gap } : { top: b.bottom + gap }),
      maxHeight: Math.min(360, Math.max(160, Math.floor(flip ? above : below))),
    });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Closing resets the question and any settled label, so reopening starts clean.
  const close = useCallback(() => {
    setOpen(false);
    setAsking(null);
    setBusy(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  async function run(action: RowAction) {
    if (!action.onSelect) return close();
    setAsking(null);
    setBusy({ label: action.pendingLabel ?? `${action.label}…`, state: 'pending' });
    try {
      await action.onSelect();
      setBusy({ label: action.doneLabel ?? 'Done', state: 'done' });
      // Long enough to be read, short enough not to trap the row. The menu closes itself so the
      // list underneath — which the action has usually just changed — is visible again.
      setTimeout(close, 1200);
    } catch {
      setBusy({
        label: action.failedLabel ?? `Couldn't ${action.label.toLowerCase()}`,
        state: 'failed',
      });
      setTimeout(() => setBusy(null), 2500);
    }
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Actions for ${label}`}
        onClick={() => (open ? close() : setOpen(true))}
        className={`min-h-9 min-w-9 grid place-items-center rounded-lg border transition ${
          open
            ? 'border-brand/40 bg-brand-mist text-brand'
            : 'border-transparent text-oat hover:border-mist hover:text-brand'
        }`}
      >
        {/* Three dots, vertical — the convention for "more, on this row". */}
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
          <path d="M12 8a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="menu"
            style={{
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              maxHeight: rect.maxHeight,
            }}
            className="fixed z-[70] w-56 overflow-y-auto rounded-xl border border-mist bg-white p-1 shadow-lg"
          >
            {asking ? (
              /* The stop, in the menu. Nothing here can be suppressed by the browser. */
              <div className="p-2.5">
                <p className="text-[12.5px] leading-snug">{asking.confirm}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => run(asking)}
                    className="min-h-9 rounded-lg bg-danger px-2.5 text-[12.5px] font-medium text-white hover:opacity-90 transition"
                  >
                    {asking.confirmLabel ?? `Yes, ${asking.label.toLowerCase()}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAsking(null)}
                    className="min-h-9 px-2 text-[12.5px] text-oat hover:text-brand transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : busy ? (
              <p
                className={`px-3 py-2.5 text-[13px] ${busy.state === 'failed' ? 'text-danger' : 'text-oat'}`}
                aria-live="polite"
              >
                {busy.label}
              </p>
            ) : (
              items.map((a) =>
                a.href ? (
                  <Link
                    key={a.label}
                    href={a.href}
                    download={a.download}
                    role="menuitem"
                    onClick={close}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] hover:bg-parchment transition"
                  >
                    {a.icon}
                    {a.label}
                  </Link>
                ) : (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    disabled={a.disabled}
                    onClick={() => (a.confirm ? setAsking(a) : run(a))}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      a.danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-parchment'
                    }`}
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ),
              )
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
