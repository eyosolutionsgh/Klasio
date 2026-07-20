'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Search by name or slug, held in the URL.
 *
 * URL state rather than component state so a filtered view can be linked, bookmarked and reached
 * with the back button — which is what someone working through a list of renewals actually does.
 *
 * Typing is debounced: each keystroke re-runs a server component, and firing one per character
 * would queue a request the next keystroke immediately makes stale.
 */
export default function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    // Skip the mount pass, or arriving on a filtered URL would immediately re-navigate to itself.
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      // Any change to the search invalidates the page you were on.
      next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
    // Deliberately keyed on the typed value alone. `params` is what this effect changes, so
    // depending on it would re-arm the debounce on the effect's own navigation; the copy read
    // inside is from the current render either way, which is the one that matters.
  }, [value]);

  return (
    <div className="relative flex-1 min-w-[14rem]">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-oat pointer-events-none"
        fill="currentColor"
      >
        <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by school or slug"
        aria-label="Search schools"
        className="field pl-9"
      />
    </div>
  );
}
