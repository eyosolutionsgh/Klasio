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
  { href: '/security', label: 'Security', isActive: (path) => path.startsWith('/security') },
];

/**
 * Set as one segmented control rather than three loose links.
 *
 * The track groups the destinations into a single object, which is the other half of telling them
 * from the wordmark beside them — a label cannot be mistaken for a link when the links are visibly
 * a set and it is not in the set. The current item is the raised one, so "where am I" is answered
 * by depth rather than by a colour somebody has to have been told about.
 */
export default function HeaderNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="flex items-center gap-0.5 rounded-full bg-hush/70 p-1 ring-1 ring-mist/70 text-sm">
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Announced as well as shown: the styling says "you are here" to everyone who can see
            // it, and this says it to everyone who cannot.
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 transition ${
              active
                ? 'bg-white text-navy font-medium shadow-sm ring-1 ring-mist/80'
                : 'text-slate hover:text-navy'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
