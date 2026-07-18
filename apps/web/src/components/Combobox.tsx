'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional second line — e.g. the level a class belongs to. */
  hint?: string;
}

/**
 * A searchable single-select, built on the ARIA combobox pattern.
 *
 * Schools reach dozens of classes and hundreds of subjects, so filters have to be typed at
 * rather than scanned. Native <select> cannot be searched beyond first-letter jumping, hence
 * this: a text input that filters an owned listbox.
 */
export default function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search…',
  allowClear = true,
  clearLabel = 'All',
  className = '',
  disabled = false,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** When true a first entry resets the filter (e.g. "All classes"). */
  allowClear?: boolean;
  clearLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const base = allowClear ? [{ value: '', label: clearLabel }, ...options] : options;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, query, allowClear, clearLabel]);

  // Close when focus or a click leaves the whole control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  }, [active, open]);

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + shown.length) % Math.max(1, shown.length);
      });
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault();
        commit(shown[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <label htmlFor={id} className="block text-[11px] uppercase tracking-wider text-oat mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          // Shows the selection when idle; becomes a search box the moment it is focused.
          value={open ? query : (selected?.label ?? (allowClear ? clearLabel : ''))}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full min-h-11 rounded-lg border border-mist bg-white pl-3.5 pr-9 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-50 disabled:bg-parchment"
        />
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 fill-oat transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>

      {open && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto overflow-x-clip rounded-lg border border-mist bg-white shadow-lg py-1"
        >
          {shown.map((o, i) => (
            <li
              key={o.value || '__all'}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              // mousedown, not click: click fires after the input's blur has already closed us.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3.5 py-2.5 text-sm ${
                i === active ? 'bg-brand-mist' : ''
              } ${o.value === value ? 'font-medium text-brand' : 'text-ink'}`}
            >
              {o.label}
              {o.hint && <span className="block text-[11px] text-oat">{o.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3.5 py-3 text-sm text-oat">Nothing matches “{query}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}
