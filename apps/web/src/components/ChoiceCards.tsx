'use client';

import type { ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Decorative, like every icon in the app — the label carries the meaning. */
  icon?: ReactNode;
}

/**
 * A small set of mutually exclusive options, drawn as cards rather than a bare radio list.
 *
 * A shared component rather than the same markup copied per form: the icon, the selected styling
 * and the keyboard semantics are easy to get subtly different each time, and a radio group whose
 * real `<input>`s have been hidden is exactly where that goes wrong.
 *
 * The inputs are `sr-only`, not `display: none` — a hidden input is removed from the accessibility
 * tree and skipped by keyboard navigation, which would leave the control mouse-only. As it stands
 * arrow keys still move between options and the label click still drives the input, because the
 * input is genuinely there.
 */
export function ChoiceCards<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  className = '',
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly Choice<T>[];
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-[13px] font-medium text-ink">{legend}</legend>
      <div className="flex gap-2" role="radiogroup" aria-label={legend}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex-1 cursor-pointer rounded-lg border px-4 py-3 transition ${
                selected ? 'border-gold bg-gold/10' : 'border-ink/15 hover:border-ink/30'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                {opt.icon && (
                  <span className={selected ? 'text-gold' : 'text-oat/70'}>{opt.icon}</span>
                )}
                {opt.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
