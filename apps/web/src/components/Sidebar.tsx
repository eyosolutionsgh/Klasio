'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z',
    tip: 'Term overview at a glance',
  },
  {
    href: '/students',
    label: 'Students',
    icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
    tip: 'Student records and guardians',
  },
  {
    href: '/attendance',
    label: 'Attendance',
    icon: 'M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.5-1.4L9 16.2z',
    tip: 'Mark and review the daily register',
  },
  {
    href: '/marks',
    label: 'Marks Entry',
    icon: 'M3 17.2V21h3.8L17.8 9.9l-3.7-3.7L3 17.2zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z',
    tip: 'Enter SBA and exam scores',
  },
  {
    href: '/reports',
    label: 'Terminal Reports',
    icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    tip: 'Generate and print GES report cards',
  },
  {
    href: '/fees',
    label: 'Fees',
    icon: 'M11.8 10.9c-2.3-.6-3-1.2-3-2.1 0-1.1 1-1.8 2.7-1.8 1.8 0 2.4.8 2.5 2h2.2c-.1-1.6-1.1-3.1-3-3.6V3.2h-3v2.2c-1.9.4-3.4 1.6-3.4 3.5 0 2.3 1.9 3.4 4.6 4 2.4.6 2.9 1.4 2.9 2.3 0 .7-.5 1.7-2.7 1.7-2 0-2.8-.9-3-2H6.4c.1 2 1.6 3.2 3.4 3.6v2.3h3v-2.2c1.9-.4 3.5-1.5 3.5-3.5 0-2.8-2.4-3.7-4.5-4.2z',
    tip: 'Billing, payments and defaulters',
  },
  {
    href: '/announcements',
    label: 'Announcements',
    icon: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4c0-.8-.7-1.5-1.5-1.5S10.5 3.2 10.5 4v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1l-2-2z',
    tip: 'Notices for staff and guardians',
  },
  {
    href: '/messaging',
    label: 'Messaging',
    icon: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 9h-2V9h2v2zm0-4h-2V5h2v2z',
    tip: 'Send bulk SMS to guardians',
  },
  {
    href: '/settings/school',
    label: 'School Setup',
    icon: 'M12 3L2 8l10 5 8-4v6h2V8L12 3zM6 13.2V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.8l-6 3-6-3z',
    tip: 'Academic years, terms, levels, classes and subjects',
  },
  {
    href: '/settings/fees',
    label: 'Fee Structure',
    icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
    tip: 'What each student is billed per term',
  },
  {
    href: '/audit',
    label: 'Audit Log',
    icon: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm-2 16l-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z',
    tip: 'Who changed what, and when',
  },
];

export default function Sidebar({
  school,
  userName,
  role,
}: {
  school: string;
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 bg-forest-deep text-paper flex flex-col min-h-screen sticky top-0 max-h-screen">
      <div className="kente-stripe h-1.5" />
      <div className="px-5 pt-6 pb-5 border-b border-paper/10">
        <p className="font-display text-xl text-gold leading-none">EYO</p>
        <p className="mt-2 text-[13px] font-medium leading-tight">{school}</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Main">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tip={item.tip}
              className={`tip flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition ${
                active
                  ? 'bg-paper/10 text-gold font-medium'
                  : 'text-paper/70 hover:text-paper hover:bg-paper/5'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-[18px] h-[18px] fill-current shrink-0"
                aria-hidden
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-paper/10">
        <p className="text-[13px] font-medium">{userName}</p>
        <p className="text-[11px] uppercase tracking-wider text-paper/50 mt-0.5">
          {role.toLowerCase().replace('_', ' ')}
        </p>
        <button
          onClick={signOut}
          className="mt-3 text-[12px] text-paper/60 hover:text-gold transition underline underline-offset-2"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
