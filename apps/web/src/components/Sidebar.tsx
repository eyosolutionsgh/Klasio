'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import SchoolCrest from './SchoolCrest';

/**
 * `needs` hides an item the package does not include; `roles` hides one this person may not use.
 *
 * Both are presentation only — the API is the authority and refuses either way. Hiding matters
 * because the alternative is worse than a locked door: an unentitled request 401s the portal
 * session and dumps the user back at the login screen, which reads as the app breaking.
 */
type Group = 'Daily' | 'Academic' | 'Finance' | 'Communication' | 'Setup';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  tip: string;
  needs?: string;
  roles?: string[];
  /** Absent means the item sits above the groups, on its own. Only Dashboard does. */
  group?: Group;
}

/**
 * Order matters — it is the order the sections render in, roughly the order of a school day:
 * who is here, what they are learning, what they owe, what you are telling families, and then
 * the settings you touch once a term.
 */
const GROUPS: Group[] = ['Daily', 'Academic', 'Finance', 'Communication', 'Setup'];

const ADMIN = ['OWNER', 'HEAD'];
const FINANCE = ['OWNER', 'HEAD', 'BURSAR'];

const NAV: NavItem[] = [
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
    group: 'Daily',
  },
  {
    href: '/admissions',
    label: 'Admissions',
    icon: 'M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zM6 8V5H4v3H1v2h3v3h2v-3h3V8H6z',
    tip: 'Applications from first enquiry to enrolment',
    needs: 'sis.admissions',
    roles: ADMIN,
    group: 'Daily',
  },
  {
    href: '/attendance',
    label: 'Attendance',
    icon: 'M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.5-1.4L9 16.2z',
    tip: 'Mark and review the daily register',
    group: 'Daily',
  },
  {
    href: '/marks',
    label: 'Marks Entry',
    icon: 'M3 17.2V21h3.8L17.8 9.9l-3.7-3.7L3 17.2zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z',
    tip: 'Enter SBA and exam scores',
    group: 'Academic',
  },
  {
    href: '/timetable',
    label: 'Timetable',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z',
    tip: 'The weekly grid for a class or a teacher',
    needs: 'timetable.core',
    group: 'Academic',
  },
  {
    href: '/reports',
    label: 'Terminal Reports',
    icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    tip: 'Generate and print GES terminal reports',
    group: 'Academic',
  },
  {
    href: '/fees',
    label: 'Fees',
    icon: 'M11.8 10.9c-2.3-.6-3-1.2-3-2.1 0-1.1 1-1.8 2.7-1.8 1.8 0 2.4.8 2.5 2h2.2c-.1-1.6-1.1-3.1-3-3.6V3.2h-3v2.2c-1.9.4-3.4 1.6-3.4 3.5 0 2.3 1.9 3.4 4.6 4 2.4.6 2.9 1.4 2.9 2.3 0 .7-.5 1.7-2.7 1.7-2 0-2.8-.9-3-2H6.4c.1 2 1.6 3.2 3.4 3.6v2.3h3v-2.2c1.9-.4 3.5-1.5 3.5-3.5 0-2.8-2.4-3.7-4.5-4.2z',
    tip: 'Billing, payments and defaulters',
    roles: FINANCE,
    group: 'Finance',
  },
  {
    href: '/pickup',
    label: 'Dismissal',
    icon: 'M12 2a5 5 0 015 5v3h1a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2h1V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v3h6V7a3 3 0 00-3-3zm0 9a2 2 0 00-1 3.7V18h2v-1.3A2 2 0 0012 13z',
    tip: 'Check who is collecting and log every release',
    needs: 'safety.pickup',
    group: 'Daily',
  },
  {
    href: '/payroll',
    label: 'Payroll',
    icon: 'M12 2a4 4 0 110 8 4 4 0 010-8zm0 10c4.4 0 8 1.8 8 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2c0-2.2 3.6-4 8-4zm5-6h4v2h-4V6zm0 4h4v2h-4v-2z',
    tip: 'Salaries, SSNIT, PAYE and payslips',
    needs: 'hr.payroll',
    group: 'Finance',
  },
  {
    href: '/transport',
    label: 'Transport',
    icon: 'M4 16c0 .9.4 1.7 1 2.2V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.8c.6-.5 1-1.3 1-2.2V6c0-3.5-3.6-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm9 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM6 11V6h12v5H6z',
    tip: 'Bus routes, manifests and boarding scans',
    needs: 'safety.transport',
    group: 'Daily',
  },
  {
    href: '/announcements',
    label: 'Announcements',
    icon: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4c0-.8-.7-1.5-1.5-1.5S10.5 3.2 10.5 4v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1l-2-2z',
    tip: 'Notices for staff and guardians',
    group: 'Communication',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zm-7-7h5v5h-5v-5z',
    tip: 'Term dates, examinations and school events',
    group: 'Communication',
  },
  {
    href: '/resources',
    label: 'Resources',
    icon: 'M4 6H2v14a2 2 0 002 2h14v-2H4V6zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm-2 9H10V9h8v2zm-3 4h-5v-2h5v2zm3-8H10V5h8v2z',
    tip: 'Notes and past questions shared with a class',
    needs: 'resources.documents',
    group: 'Academic',
  },
  {
    href: '/messaging',
    label: 'Messaging',
    icon: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 9h-2V9h2v2zm0-4h-2V5h2v2z',
    tip: 'Send bulk SMS to guardians',
    needs: 'comms.sms',
    group: 'Communication',
  },
  {
    href: '/whatsapp',
    label: 'WhatsApp',
    icon: 'M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 2a8 8 0 110 16 8 8 0 01-4.2-1.2l-.4-.2-2.6.7.7-2.5-.3-.4A8 8 0 0112 4zm-3.3 4.3c-.2 0-.4 0-.6.3l-.5.9c-.4.9.1 2 .8 2.9a8 8 0 003.4 2.8c1.3.5 1.9.4 2.4.2l.9-.6c.2-.2.2-.4.1-.6l-1-1c-.2-.2-.4-.2-.6 0l-.6.5c-.2.2-.4.2-.6.1a6 6 0 01-2.4-2.2c-.1-.2-.1-.4.1-.6l.5-.5c.2-.2.1-.4 0-.6l-.9-1.4c-.1-.2-.3-.2-.5-.2z',
    tip: 'Replies to families who wrote to the school — you cannot start a chat',
    needs: 'comms.whatsapp.templates',
    group: 'Communication',
  },
  {
    href: '/settings/school',
    label: 'School Setup',
    icon: 'M12 3L2 8l10 5 8-4v6h2V8L12 3zM6 13.2V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.8l-6 3-6-3z',
    tip: 'Academic years, terms, levels, classes and subjects',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/branding',
    label: 'Profile & Branding',
    icon: 'M12 3l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8L12 3z',
    tip: 'Your crest, colour and contact details',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/records',
    label: 'Records Setup',
    icon: 'M19 3h-4.2A3 3 0 0012 1a3 3 0 00-2.8 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 0a1 1 0 110 2 1 1 0 010-2zm-2 15l-3-3 1.4-1.4L10 15.2l5.6-5.6L17 11l-7 7z',
    tip: 'Extra student fields, required documents and the remark bank',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/fees',
    label: 'Fee Structure',
    icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
    tip: 'What each student is billed per term',
    roles: FINANCE,
    group: 'Finance',
  },
  {
    href: '/settings/staff',
    label: 'Staff Accounts',
    icon: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    tip: 'Staff accounts and what each role may do',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/roles',
    label: 'Roles & Permissions',
    icon: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 4a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm0 6.5c1.9 0 4.5.9 4.5 2.6V16h-9v-1.9c0-1.7 2.6-2.6 4.5-2.6z',
    tip: 'What each role may do, and who holds it',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/social',
    label: 'Social Accounts',
    icon: 'M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.2c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8 9.9c-.5-.5-1.2-.9-2-.9-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.6 1.3 2.9 2.9 2.9s2.9-1.3 2.9-2.9-1.2-2.9-2.8-2.9z',
    tip: 'Facebook, Instagram and more — post announcements straight to them',
    needs: 'comms.social',
    roles: ADMIN,
    group: 'Communication',
  },
  {
    href: '/settings/gateways',
    label: 'Payment Setup',
    icon: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a2 2 0 110 4 2 2 0 010-4zm0 5c1.7 0 5 .8 5 2.5V16H7v-1.5C7 12.8 10.3 12 12 12z',
    tip: 'Connect your Hubtel or Paystack account',
    needs: 'fees.online',
    roles: FINANCE,
    group: 'Finance',
  },
  {
    href: '/settings/reconciliation',
    label: 'Reconciliation',
    icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4zM12 3.5l-1.9 1.1 1.9 3.3 1.9-3.3L12 3.5zm0 17l1.9-1.1-1.9-3.3-1.9 3.3 1.9 1.1z',
    tip: 'Match a gateway settlement file against the payments you hold',
    needs: 'fees.reconciliation',
    roles: FINANCE,
    group: 'Finance',
  },
  {
    href: '/settings/returns',
    label: 'Termly Returns',
    icon: 'M19 3h-4.2A3 3 0 0012 1a3 3 0 00-2.8 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 0a1 1 0 110 2 1 1 0 010-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z',
    tip: 'The counts GES and NaSIA ask for each term',
    needs: 'platform.ges-returns',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/settings/licence',
    label: 'Licence',
    icon: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 10.9h7c-.5 4-3.1 7.6-7 8.9V12H5V6.3l7-3.1v8.7z',
    // Deliberately no `needs`: the page that says what this school is entitled to cannot itself
    // be gated on an entitlement, or a lapsed school loses the screen it needs to fix the lapse.
    tip: 'What this school is licensed for, and how to renew',
    roles: ADMIN,
    group: 'Setup',
  },
  {
    href: '/audit',
    label: 'Audit Log',
    icon: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm-2 16l-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z',
    tip: 'Who changed what, and when',
    roles: ADMIN,
    group: 'Setup',
  },
];

export default function Sidebar({
  school,
  hasLogo,
  entitlements,
  role,
  termLabel,
  tier,
  open = false,
  onClose,
}: {
  school: string;
  hasLogo: boolean;
  entitlements: string[];
  role: string;
  /** e.g. "2025/2026 · Term 3" — standing context, so it lives at the foot rather than the top. */
  termLabel: string;
  tier: string;
  /** Drawer state — only meaningful below `lg`, where the sidebar is off-canvas. */
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const visible = NAV.filter(
    (item) =>
      (!item.needs || entitlements.includes(item.needs)) &&
      (!item.roles || item.roles.includes(role)),
  );

  const ungrouped = visible.filter((i) => !i.group);
  const sections = GROUPS.map((name) => ({
    name,
    items: visible.filter((i) => i.group === name),
    // A section a school cannot use is not rendered at all — an empty "Finance" heading for a
    // teacher is worse than no heading.
  })).filter((sec) => sec.items.length > 0);

  /**
   * Which sections are open.
   *
   * Seeded from the current page rather than defaulting everything open or closed: arriving on
   * /fees should show you where you are without a click, and closing a section you are not using
   * should stick while you work.
   */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const here = visible.find((i) => i.group && pathname.startsWith(i.href));
    return new Set(here?.group ? [here.group] : [GROUPS[0]]);
  });

  // Following a link into a collapsed section must reveal it, or the user loses their place.
  // Reads NAV rather than `visible` so the effect depends only on the path: `visible` is rebuilt
  // every render, and depending on it would re-run this constantly.
  const currentGroup = NAV.find((i) => i.group && pathname.startsWith(i.href))?.group;
  useEffect(() => {
    if (!currentGroup) return;
    setOpenGroups((prev) => (prev.has(currentGroup) ? prev : new Set(prev).add(currentGroup)));
  }, [currentGroup]);

  const toggle = (name: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const link = (item: NavItem) => {
    const active = pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        data-tip={item.tip}
        className={`tip flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition ${
          active
            ? 'bg-paper/10 text-paper font-medium'
            : 'text-paper/70 hover:text-paper hover:bg-paper/5'
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-current shrink-0" aria-hidden>
          <path d={item.icon} />
        </svg>
        {item.label}
      </Link>
    );
  };

  return (
    <aside
      id="portal-nav"
      // Below lg: a fixed drawer that slides in. From lg: an ordinary sticky column, so the
      // desktop layout is untouched.
      className={`no-print texture-weave bg-brand-deep text-paper flex flex-col z-50
        fixed inset-y-0 left-0 w-[17rem] max-w-[85vw]
        transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none
        ${
          open
            ? 'translate-x-0 visible shadow-2xl'
            : // invisible keeps the off-screen links out of the tab order; lg:visible puts the
              // permanent desktop column back.
              '-translate-x-full invisible lg:visible'
        }
        lg:translate-x-0 lg:w-60 lg:shrink-0 lg:shadow-none
        lg:sticky lg:top-0 lg:h-dvh`}
    >
      <div className="accent-rule-gold h-[3px]" />
      {/*
        Stacked, not a row. Beside the text the crest was capped by the height of two small lines
        and had to share a 200px column with them; on its own row it can be read as a mark rather
        than an icon, and the school's name gets the full width instead of ~140px — which is what
        long names here need ("St. Augustine's International Preparatory School").

        The close button is taken out of the flow so it stays pinned to the corner rather than
        being pushed down by whatever the stack grows to.
      */}
      <div className="relative px-5 pt-6 pb-5 border-b border-paper/10">
        <SchoolCrest name={school} hasLogo={hasLogo} size={76} onDark />
        <p className="mt-3.5 text-[14px] font-medium leading-snug">{school}</p>
        {/* Where you are, under whose school it is. The vendor's mark has moved to the foot —
            this corner belongs to the school. */}
        <p className="mt-1 text-[11.5px] text-paper/55 leading-none">{termLabel}</p>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="lg:hidden absolute right-3 top-4 p-2 rounded-lg text-paper/60 hover:text-paper hover:bg-paper/10 transition"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
            <path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" />
          </svg>
        </button>
      </div>

      {/* overflow-y-auto alone would coerce the x axis to auto and give the nav its own
          horizontal scrollbar the moment a tooltip is wider than the sidebar. */}
      <nav
        className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto overflow-x-clip"
        aria-label="Main"
      >
        {ungrouped.map(link)}

        {sections.map((sec) => {
          const isOpen = openGroups.has(sec.name);
          // A collapsed section still marks itself when the current page is inside it, so you
          // can see where you are without opening anything.
          const holdsCurrent = sec.items.some((i) => pathname.startsWith(i.href));
          return (
            <div key={sec.name} className="pt-2">
              <button
                type="button"
                onClick={() => toggle(sec.name)}
                aria-expanded={isOpen}
                aria-controls={`nav-${sec.name}`}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11px] uppercase tracking-widest transition ${
                  holdsCurrent && !isOpen
                    ? 'text-paper hover:bg-paper/5'
                    : 'text-paper/45 hover:text-paper/70 hover:bg-paper/5'
                }`}
              >
                {sec.name}
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className={`w-3.5 h-3.5 fill-current transition-transform ${isOpen ? '' : '-rotate-90'}`}
                >
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              {/* Unmounted rather than hidden when closed: a display:none link is out of the tab
                  order anyway, and keeping it mounted only costs DOM. */}
              {isOpen && (
                <div id={`nav-${sec.name}`} className="mt-0.5 space-y-0.5">
                  {sec.items.map(link)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/*
        Whose software this is, and what the school pays for. `mt-auto` pins it below a nav short
        enough not to fill the column.

        The lockup sits on a light panel. It was cut from artwork on a white background, so its
        solid areas are about 90% opaque — dropped straight onto the dark green it would look
        faded rather than obviously wrong, which is the harder kind of wrong to notice. Recolouring
        someone's logo to suit our palette is not ours to do, so the surface changes instead.
      */}
      <div className="mt-auto shrink-0 px-5 py-4 border-t border-paper/10">
        {/*
          Labelled, and smaller than it was. The school owns this sidebar — its crest is at the top
          at 76px — so the supplier's mark at the foot should read as a signature rather than a
          second brand competing with it.
        */}
        <p className="text-[10px] uppercase tracking-widest text-paper/35">Powered by</p>
        <div className="mt-1.5 rounded-lg bg-paper/95 px-3 py-2 grid place-items-center">
          {/* Sized by width, not height. At a fixed 24px tall the mark floated in a mostly empty
              panel and the strapline collapsed into a smudge; filling the column's width gives
              both room to be read. It stays on a light plate: the artwork was keyed off white and
              washes out rather than failing obviously on the navy. */}
          <img
            src="/brand/klasio-lockup.png"
            alt="Klasio — School Management System"
            className="w-full max-w-[120px] h-auto"
          />
        </div>
        <p className="mt-2 text-[11px] text-paper/40 leading-relaxed">
          {/* Sentence case, not the shouted uppercase of the old badge. */}
          {tier.charAt(0) + tier.slice(1).toLowerCase()} plan
        </p>
      </div>
    </aside>
  );
}
