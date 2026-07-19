'use client';

import { useEffect, useRef, useState } from 'react';

export const fileSize = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * `accept` mixes MIME types (`text/csv`), wildcards (`image/*`) and bare extensions (`.xlsx`).
 * The browser only applies it to its own picker, so a *dragged* file is unfiltered — without
 * this check the drop zone would happily take a .mp4 and let the server reject it.
 */
function accepted(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((p) =>
      p.startsWith('.')
        ? name.endsWith(p)
        : p.endsWith('/*')
          ? type.startsWith(p.slice(0, -1))
          : type === p,
    );
}

/**
 * One file picker for the forms that stage a file and submit it with everything else.
 *
 * Replaces the browser's native `<input type="file">` widget, which cannot be styled, renders
 * differently on every platform, and says only "No file chosen". It is fully controlled: the
 * parent owns the File, so clearing it after a successful submit also clears what is shown.
 *
 * The real input stays mounted and focusable behind `sr-only` — hiding it with `display: none`
 * would drop it out of the tab order and leave the control unusable by keyboard. It keeps the
 * caller's `id`, so an existing `<label htmlFor>` still points at it.
 */
export default function FileField({
  id,
  accept,
  hint,
  value,
  onChange,
  maxBytes = 8 * 1024 * 1024,
  disabled,
}: {
  id: string;
  accept?: string;
  /** Shown under the control when nothing is wrong. */
  hint?: string;
  value: File | null;
  onChange: (file: File | null) => void;
  maxBytes?: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // dragenter/dragleave fire for every child the pointer crosses, so a plain boolean flickers
  // the entire time you move inside the zone. Counting enters against leaves does not.
  const depth = useRef(0);

  // The parent clearing `value` (after a successful submit) must also reset the native input,
  // or re-picking the very same file fires no change event and the form looks stuck.
  useEffect(() => {
    if (!value && inputRef.current) inputRef.current.value = '';
  }, [value]);

  function take(file: File | undefined) {
    if (!file) return;
    if (!accepted(file, accept)) {
      setProblem(`${file.name} is not a file this accepts.`);
      return;
    }
    if (file.size > maxBytes) {
      setProblem(`${file.name} is ${fileSize(file.size)}. The limit is ${fileSize(maxBytes)}.`);
      return;
    }
    setProblem(null);
    onChange(file);
  }

  function clear() {
    setProblem(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => !disabled && e.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => take(e.target.files?.[0])}
        className="sr-only"
      />

      {value ? (
        // A real row of buttons rather than a label — a <button> inside a <label> would both
        // fire its own handler and re-open the file dialog.
        <div className="flex items-center gap-3 rounded-xl border border-mist bg-white px-3 py-2.5">
          <span
            aria-hidden
            className="shrink-0 w-9 h-9 rounded-lg grid place-items-center bg-brand-mist text-brand"
          >
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-current">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{value.name}</span>
            <span className="block text-[12px] text-oat">{fileSize(value.size)}</span>
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-mist transition"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label={`Remove ${value.name}`}
            className="shrink-0 rounded-md p-1.5 text-oat hover:bg-clay/10 hover:text-clay transition"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden>
              <path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" />
            </svg>
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={`flex items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-5 text-[13px] text-center transition focus-within:ring-2 focus-within:ring-brand/30 ${
            disabled
              ? 'border-mist bg-parchment/30 text-oat/60 cursor-not-allowed'
              : dragging
                ? 'border-brand bg-brand-mist text-brand cursor-pointer'
                : 'border-mist bg-parchment/40 text-oat hover:border-brand hover:bg-brand-mist/40 hover:text-brand cursor-pointer'
          }`}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0" aria-hidden>
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
          </svg>
          <span>
            <span className="font-medium">{dragging ? 'Drop to attach' : 'Drag a file here'}</span>
            {!dragging && <span className="text-oat"> or click to browse</span>}
          </span>
        </label>
      )}

      {problem ? (
        <p role="alert" className="mt-1.5 text-[12px] text-danger">
          {problem}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-[11px] text-oat">{hint}</p>
      )}
    </div>
  );
}
