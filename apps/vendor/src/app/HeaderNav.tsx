'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The nav, and which of it you are looking at.
 *
 * A client component only because knowing the current page needs the current path. Everything
 * else in this portal stays server-rendered.
 */
const ITEMS: { href: string; label: string; isActive: (path: string) => boolean }[] = [
  {
    href: '/',
    label: 'Schools',
    /*
      Not `startsWith('/')`, which is every page. A school's own page lives at /clients/[id] and is
      still Schools — following a row into a client and finding nothing lit is how a nav teaches
      you not to trust it.
    */
    isActive: (path) => path === '/' || path.startsWith('/clients'),
  },
  { href: '/packages', label: 'Packages', isActive: (path) => path.startsWith('/packages') },
  { href: '/security', label: 'Signing in', isActive: (path) => path.startsWith('/security') },
];

export default function HeaderNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Announced as well as shown: the styling says "you are here" to everyone who can see
            // it, and this says it to everyone who cannot.
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 transition ${
              active
                ? 'bg-hush text-navy font-medium'
                : 'text-slate hover:text-navy hover:bg-hush/60'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
