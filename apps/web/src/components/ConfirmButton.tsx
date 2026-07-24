'use client';

import { useState, type ReactNode } from 'react';
import { Button, useAsyncAction } from './Button';

/**
 * A destructive or reason-carrying action, confirmed inside the page.
 *
 * It replaces `window.confirm` / `window.prompt`, which silently return false/null in the embedded
 * preview browser — the action then reads as a dead button — and which cannot carry the reason an
 * API demands (reopening a year, returning a lesson note). The trigger looks like the small text
 * button it stands in for; clicking it swaps in an inline strip that asks the question, optionally
 * takes a required reason, and drives the confirm through the shared Button's pending/done states.
 * State is self-contained, so it composes inside a `.map()`ed row without lifting anything.
 */
export default function ConfirmButton({
  label,
  question,
  confirmLabel = 'Confirm',
  onConfirm,
  reason,
  danger,
  triggerClassName,
}: {
  label: ReactNode;
  question: string;
  confirmLabel?: string;
  onConfirm: (reason?: string) => Promise<unknown> | unknown;
  /** When set, a reason is collected and required at `minLength` (default 1) before confirming. */
  reason?: { label: string; minLength?: number };
  danger?: boolean;
  /** Classes for the idle trigger, so it matches the button it replaces. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const min = reason?.minLength ?? 1;
  const ready = !reason || value.trim().length >= min;

  const action = useAsyncAction(async () => {
    await onConfirm(reason ? value.trim() : undefined);
    setOpen(false);
    setValue('');
  });

  const close = () => {
    setOpen(false);
    setValue('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? 'text-[12px] font-medium text-oat hover:text-danger'}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-mist bg-paper px-2.5 py-1.5 text-[12px] shadow-sm">
      <span className="text-ink/80">{question}</span>
      {reason && (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={reason.label}
          placeholder={reason.label}
          className="min-w-[9rem] rounded-md border border-mist bg-white px-2 py-1 text-[12px] outline-none focus:border-brand"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) action.run();
            if (e.key === 'Escape') close();
          }}
        />
      )}
      <Button
        size="sm"
        variant={danger ? 'danger' : 'primary'}
        state={action.state}
        disabled={!ready}
        onClick={() => action.run()}
      >
        {confirmLabel}
      </Button>
      <button type="button" onClick={close} className="text-oat hover:text-ink">
        Cancel
      </button>
    </span>
  );
}
