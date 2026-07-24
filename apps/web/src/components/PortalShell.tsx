'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Sidebar from './Sidebar';
import UserMenu from './UserMenu';
import SchoolCrest from './SchoolCrest';

/**
 * Portal chrome. The sidebar is a permanent column from `lg` up and an off-canvas drawer below
 * it, so the trigger and the drawer have to share state — hence one client component wrapping
 * both, with the server layout passing the already-fetched school context in as props.
 */
export default function PortalShell({
  school,
  hasLogo,
  brandColor,
  userName,
  userEmail,
  role,
  job,
  permissions,
  termLabel,
  tier,
  entitlements,
  children,
}: {
  school: string;
  hasLogo: boolean;
  brandColor: string | null;
  userName: string;
  userEmail?: string;
  role: string;
  /** The staff role's name — the person's job, shown in the header under their name. */
  job?: string | null;
  /** Passed straight through to the menu, which shows only what these can open. */
  permissions: string[];
  termLabel: string;
  tier: string;
  entitlements: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Tapping a nav link should navigate *and* get the drawer out of the way.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the drawer scrolling under the user's finger.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    // The school's colour enters the cascade here as --brand; the deep and mist variants are
    // derived from it in globals.css, so one stored value themes every primary surface.
    <div
      className="brand-scope flex min-h-dvh"
      style={brandColor ? ({ '--brand': brandColor } as React.CSSProperties) : undefined}
    >
      {open && (
        <div
          onClick={close}
          className="no-print fixed inset-0 z-40 bg-ink/50 backdrop-blur-[1px] lg:hidden"
          aria-hidden
        />
      )}

      <Sidebar
        school={school}
        hasLogo={hasLogo}
        entitlements={entitlements}
        role={role}
        permissions={permissions}
        termLabel={termLabel}
        tier={tier}
        open={open}
        onClose={close}
      />

      <div className="flex-1 min-w-0 overflow-x-clip flex flex-col">
        <header className="no-print flex items-center justify-between gap-3 px-4 lg:px-6 h-16 border-b border-mist bg-paper/80 backdrop-blur sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={triggerRef}
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="portal-nav"
              className="lg:hidden -ml-1 p-2 rounded-lg text-ink/70 hover:bg-parchment transition"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
                <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
              </svg>
            </button>

            {/*
              The school named exactly once, at every width. Below `lg` the sidebar is an
              off-canvas drawer, so this — beside the menu trigger — is the only place the school
              appears, and it must be here. From `lg` up the sidebar is a permanent column whose own
              header (crest, name and term) is pinned at the top of a full-height sticky aside, so
              it is always in view; repeating the crest and name here would put the same mark twice
              a few hundred pixels apart. Hidden from `lg`, then, leaving the sidebar to carry the
              brand on desktop and this to carry it on a phone.
            */}
            <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 lg:hidden">
              <SchoolCrest name={school} hasLogo={hasLogo} size={40} />
              <span className="block text-[15px] font-medium truncate max-w-[12rem] sm:max-w-none">
                {school}
              </span>
            </Link>
          </div>

          {/* The package moved to the foot of the sidebar; the user menu is what is left here. */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <UserMenu name={userName} role={role} job={job} email={userEmail} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 max-w-6xl w-full">{children}</main>
      </div>
    </div>
  );
}
