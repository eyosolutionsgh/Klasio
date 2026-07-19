'use client';

import type { ReactNode } from 'react';
import SchoolCrest from './SchoolCrest';
import { useBrand } from './Brand';

/**
 * The header the guardian and student portals wear.
 *
 * Both used to hand-roll this, identically and separately: the school's name as text, on a fixed
 * navy bar, with no crest. So the two audiences least likely to have heard of Klasio — a parent
 * and a child — got the one view of the product with no sign of their own school on it beyond a
 * line of type.
 *
 * Now it carries the crest, and the bar takes the school's own colour when one is set. The gold
 * fallback stays for schools that have chosen no colour, because it is what the accent rule and
 * the sign-out link are already keyed to.
 */
export default function PortalBrandHeader({
  schoolName,
  subtitle,
  action,
}: {
  schoolName: string;
  /** Who is signed in — the guardian's name, or the student's name and class. */
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  const brand = useBrand();

  return (
    <header
      className={`text-paper pt-[env(safe-area-inset-top)] ${brand.brandColor ? '' : 'bg-forest-deep'}`}
      // `--brand-deep` rather than `--brand`: this is a large solid field behind white text, and
      // the deep mix is what globals.css derives for exactly that. Falls through to the navy class
      // above when the school has chosen no colour.
      style={brand.brandColor ? { background: 'var(--brand-deep)' } : undefined}
    >
      <div className="accent-rule-gold h-[3px]" />
      <div className="max-w-3xl mx-auto px-5 py-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          {/*
            `pub`: a guardian holds a family session and a student holds their own, neither of
            which is the staff cookie /api/proxy attaches. The unauthenticated branding route is
            the one both can actually read.
          */}
          <SchoolCrest name={schoolName} hasLogo={brand.hasLogo} size={48} onDark pub />
          <div className="min-w-0">
            <p className="font-display text-xl text-gold-bright leading-none text-balance">
              {schoolName}
            </p>
            <p className="text-[13px] text-paper/70 mt-1.5">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}
