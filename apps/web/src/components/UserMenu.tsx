'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const ITEMS = [
  {
    href: '/settings/profile',
    label: 'My profile',
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  },
  {
    href: '/guide',
    label: 'User guide',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  },
  {
    href: '/help',
    label: 'Help & support',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 17h-2v-2h2v2zm2.1-7.7l-.9.9c-.7.7-1.2 1.3-1.2 2.8h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3c.4-.3.6-.8.6-1.4a2 2 0 10-4 0H8a4 4 0 118 0c0 .9-.4 1.7-.9 2.3z',
  },
];

/** Initials for the avatar — two letters at most, so it stays legible at 36px. */
function initials(name: string): string {
  const parts = name
    .replace(/^(Mr|Mrs|Ms|Dr|Prof)\.?\s+/i, '')
    .trim()
    .split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')
  ).toUpperCase();
}

export default function UserMenu({
  name,
  role,
  job,
  email,
}: {
  name: string;
  role: string;
  /** The staff role's name — what this person does. Absent when they hold no role. */
  job?: string | null;
  email?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 min-h-11 hover:bg-parchment transition"
      >
        <span
          aria-hidden
          className="w-9 h-9 shrink-0 rounded-full bg-brand text-paper grid place-items-center text-[13px] font-medium"
        >
          {initials(name)}
        </span>
        {/* Which account you are acting as — acting as the wrong one is the costly mistake — so
            it stays visible at every width. Only the name, which the avatar initials already stand
            in for, drops away on a phone.

            The person's *job* (their staff role: "Bursar", "System Administrator"), not the coarse
            account type, which since the type choice was retired says only "staff" and used to say
            worse: an administrator's header read FRONT DESK, because that was the nearest word the
            old five-value list had for them. */}
        <span className="text-left leading-tight max-w-[9rem]">
          <span className="hidden sm:block text-[13px] font-medium truncate">{name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-oat truncate">
            {job ?? (role === 'OWNER' ? 'Proprietor' : 'No role yet')}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`w-4 h-4 fill-oat transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 mt-1 w-60 rounded-xl border border-mist bg-white shadow-lg py-1.5 z-50"
        >
          <div className="px-4 py-2.5 border-b border-mist/70">
            <p className="text-sm font-medium truncate">{name}</p>
            {email && <p className="text-[11px] text-oat truncate">{email}</p>}
          </div>
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 min-h-11 text-[13.5px] text-ink hover:bg-parchment transition"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="w-[18px] h-[18px] fill-oat shrink-0">
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          ))}
          <div className="border-t border-mist/70 mt-1.5 pt-1.5">
            <button
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-3 px-4 py-2.5 min-h-11 text-[13.5px] text-clay hover:bg-parchment transition"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="w-[18px] h-[18px] fill-clay shrink-0">
                <path d="M17 7l-1.4 1.4L18.2 11H8v2h10.2l-2.6 2.6L17 17l5-5-5-5zM4 5h8V3H4a2 2 0 00-2 2v14a2 2 0 002 2h8v-2H4V5z" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
