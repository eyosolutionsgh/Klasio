'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchIcon } from './icons';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional second line — e.g. the level a class belongs to. */
  hint?: string;
}

/**
 * How tall the panel wants to be — about four options with their hints — and the least it will
 * accept before it would rather open upwards.
 */
const PREFERRED_PANEL = 288;
const MIN_PANEL = 176;

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
  const fieldRef = useRef<HTMLDivElement>(null);
  /**
   * The panel is rendered into <body>, so it needs the field's viewport coordinates.
   *
   * Rendering in place looked simpler but could not work: filter rows sit inside cards with
   * `overflow-x-auto`, which clips a child panel no matter its z-index, and any transformed
   * ancestor traps it in that stacking context. Portalling to the body escapes both.
   */
  const [rect, setRect] = useState<{
    /** One of `top`/`bottom` is set, never both — see `measure`. */
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
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

  /**
   * Where the panel fits, not just where the field is.
   *
   * It used to hang below the field at a fixed 16rem, which is fine until the field is near the
   * foot of the window — then the list simply ran off the bottom edge and the last options could
   * not be reached at all. Being `position: fixed` in a body portal, nothing clipped it into view
   * or gave it a scrollbar; it was just gone.
   *
   * So: measure both gaps, keep the panel below unless below is too cramped to use and above is
   * roomier, and cap its height to whatever space it actually has. `bottom` rather than a computed
   * `top` when flipping, because the panel's height depends on how many options match and is not
   * known until after it renders.
   */
  const measure = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const gap = 4;
    // Never flush against the window edge — a panel touching it reads as cut off even when whole.
    const margin = 8;
    const below = window.innerHeight - b.bottom - gap - margin;
    const above = b.top - gap - margin;
    // Flip whenever below cannot show a comfortable list and above can do better. Only flipping
    // at the point below became unusable left the common case looking broken: the field sits near
    // the foot of a form, ~190px of list is squeezed in against the window edge with a row sliced
    // through the middle, while 700px of room sits unused above it.
    const flip = below < PREFERRED_PANEL && above > below;
    setRect({
      left: b.left,
      width: b.width,
      ...(flip ? { bottom: window.innerHeight - b.top + gap } : { top: b.bottom + gap }),
      // Floored at MIN_PANEL: on a short window both gaps can be tiny, and a 40px panel is worse
      // than one that overhangs slightly but can be scrolled. Capped so a field at the foot of a
      // long page does not open a full-height wall of options.
      maxHeight: Math.min(384, Math.max(MIN_PANEL, Math.floor(flip ? above : below))),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // `true` captures scrolls on any ancestor, not just the window, so the panel keeps up with
    // a scrolling card as well as the page.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Close when focus or a click leaves the whole control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel lives outside rootRef in the DOM, so it has to be checked separately or
      // clicking an option would count as clicking away.
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
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
      <div ref={fieldRef} className="relative">
        {/* A magnifier, not a dropdown glyph: the chevron on the right already says "list", and
            what this control asks of a user that a <select> does not is that they type. */}
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
          <SearchIcon />
        </span>
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
          className="w-full min-h-11 rounded-lg border border-mist bg-white pl-10 pr-9 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-50 disabled:bg-parchment"
        />
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 fill-oat transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>

      {open &&
        rect &&
        createPortal(
          <ul
            id={`${id}-list`}
            ref={listRef}
            role="listbox"
            aria-label={label}
            style={{
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              maxHeight: rect.maxHeight,
            }}
            className="fixed z-[70] overflow-y-auto overflow-x-clip rounded-lg border border-mist bg-white shadow-lg py-1"
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
