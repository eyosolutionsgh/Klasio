'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

/**
 * Portal chrome. The sidebar is a permanent column from `lg` up and an off-canvas drawer below
 * it, so the trigger and the drawer have to share state — hence one client component wrapping
 * both, with the server layout passing the already-fetched school context in as props.
 */
export default function PortalShell({
  school,
  userName,
  role,
  termLabel,
  tier,
  children,
}: {
  school: string;
  userName: string;
  role: string;
  termLabel: string;
  tier: string;
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
    <div className="flex">
      {open && (
        <div
          onClick={close}
          className="no-print fixed inset-0 z-40 bg-ink/50 backdrop-blur-[1px] lg:hidden"
          aria-hidden
        />
      )}

      <Sidebar school={school} userName={userName} role={role} open={open} onClose={close} />

      <div className="flex-1 min-w-0 overflow-x-clip">
        <header className="no-print flex items-center justify-between gap-3 px-4 lg:px-8 h-14 border-b border-mist bg-paper/70 backdrop-blur sticky top-0 z-30">
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
            <p className="text-[13px] text-oat truncate">{termLabel}</p>
          </div>
          <span
            data-tip="Your school's package — features unlock by package"
            className="tip shrink-0 text-[11px] uppercase tracking-widest font-medium text-forest bg-forest-mist rounded-full px-3 py-1"
          >
            {tier}
          </span>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8 max-w-6xl">{children}</main>
      </div>
    </div>
  );
}
