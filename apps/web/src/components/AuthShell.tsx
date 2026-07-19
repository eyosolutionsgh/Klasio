'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import SchoolCrest from './SchoolCrest';
import { useBrand, type BrandPhotoSlot } from './Brand';

/**
 * Which door this is, and what hangs behind it.
 *
 * Chosen by route rather than passed in: there are fifteen `<AuthShell>` call sites across seven
 * pages, and threading a prop through all of them to say "this is the staff one" would put art
 * direction into pages that are otherwise entirely about forms. The route already knows.
 *
 * Each slot has a picture the product ships and a picture the school may upload instead. The
 * shipped ones are CC0 and show no identifiable child — see public/photos/LICENSES.md, which
 * explains why that is a rule and not a coincidence. A school's own photograph of its own
 * building is better than any of them, which is the point of letting them replace it.
 */
const DOORS: {
  match: (p: string) => boolean;
  slot: BrandPhotoSlot;
  src: string;
  srcSet: string;
}[] = [
  {
    match: (p) => p.startsWith('/family'),
    slot: 'FAMILY',
    src: '/photos/auth/courtyard-800.webp',
    srcSet: '/photos/auth/courtyard-800.webp 800w, /photos/auth/courtyard-1400.webp 1400w',
  },
  {
    match: (p) => p.startsWith('/student'),
    slot: 'STUDENT',
    src: '/photos/auth/courtyard-800.webp',
    srcSet: '/photos/auth/courtyard-800.webp 800w, /photos/auth/courtyard-1400.webp 1400w',
  },
  {
    // Password reset and first-run setup — pages nobody arrives at on purpose.
    match: (p) => p.includes('password') || p.startsWith('/setup'),
    slot: 'GENERAL',
    src: '/photos/auth/courtyard-800.webp',
    srcSet: '/photos/auth/courtyard-800.webp 800w, /photos/auth/courtyard-1400.webp 1400w',
  },
  {
    match: () => true,
    slot: 'STAFF',
    src: '/photos/auth/schoolyard-800.webp',
    srcSet: '/photos/auth/schoolyard-800.webp 800w, /photos/auth/schoolyard-1400.webp 1400w',
  },
];

/**
 * The frame every sign-in page sits in.
 *
 * One card, floating on a tinted page, split into a form half and an angled art half. The three
 * doors into this product — staff, guardian and student — used to look like three different
 * products: one was a full-bleed two-column split, the other two were small centred boxes. They
 * share this now, so a parent who has seen a teacher's screen recognises where they are.
 *
 * ## Whose product this looks like
 *
 * It used to be Klasio's. The only mark on any sign-in page was the Klasio lockup at 56px, and the
 * school's name and crest appeared nowhere at all — they could not, because on a shared hostname
 * there was no way to know which school was at the door.
 *
 * One school per server changed that, so the hierarchy is now the honest one: the school's crest
 * and name lead, the page's own title is demoted beneath them, and Klasio signs the bottom of the
 * card as the supplier. A parent signing in is visiting their child's school, not a software
 * company.
 *
 * The art panel is absolutely positioned rather than a grid column, because its chevron has to cut
 * *into* the form half to read as one shape rather than two rectangles side by side. It is hidden
 * below `lg`, where there is no room for it and the form should have the whole card.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  /** Optional: the staff page deliberately has none. */
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const brand = useBrand();
  const pathname = usePathname() ?? '';
  const door = DOORS.find((d) => d.match(pathname))!;
  /*
    The school's own picture wins when it has uploaded one for this door. Decided from the slot
    list rather than by trying the URL and handling a 404, so the shipped default is never
    requested and then thrown away — and so a school that has replaced nothing costs no extra
    request at all.
  */
  const usesOwn = brand.photoSlots.includes(door.slot);
  const photo = usesOwn
    ? { src: `/api/branding/photo/${door.slot}`, srcSet: undefined }
    : { src: door.src, srcSet: door.srcSet };
  // A box that has not been set up yet genuinely has no school, and the setup page is the one
  // that runs there. Naming the product is the honest answer rather than an empty heading.
  const schoolName = brand.name ?? 'Klasio';

  return (
    // No page-level fill: the body's paper grain is the background here, and an opaque tint
    // would sit on top of it.
    <main className="min-h-dvh grid place-items-center p-4 sm:p-8">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(27,40,34,0.35)]">
        {/*
          The accent spans the whole card, above the clip: the clip-path cuts its children, so a
          rule that starts partway across reads as a loose fragment rather than an edge. It picks
          up the school's own colour now, which on these pages it never could before.
        */}
        <div className="accent-rule h-[3px] absolute top-0 left-0 right-0 z-10" />

        {/* Art half. Sits above the form's right margin, so the point lands inside the card. */}
        <div
          aria-hidden
          className="texture-weave hidden lg:block absolute inset-y-0 right-0 w-[52%] bg-forest-deep overflow-hidden"
          style={{ clipPath: 'polygon(16% 0, 100% 0, 100% 100%, 16% 100%, 0 50%)' }}
        >
          {/*
            Behind a scrim, always. The display copy over it has to stay readable against a
            photograph nobody has colour-checked, and a school swapping in its own picture of a
            bright courtyard must not silently break the contrast of the words on top.

            `onError` hides the image rather than showing a broken one: the panel's woven texture
            and navy are underneath, so a missing file degrades to exactly how this looked before
            there were any photographs.
          */}
          <img
            src={photo.src}
            srcSet={photo.srcSet}
            sizes="(min-width: 1024px) 52vw, 0px"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {/*
            Graded, not flat. The copy sits in the panel's left third (see `left-[16%]` below), so
            that is where the scrim needs to be heavy; carrying the same 65% across the whole panel
            paid full contrast cost everywhere and flattened the photograph to grey for nothing.
            Heavy left, light right: the words stay legible and the picture still reads as one.
          */}
          <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/90 via-forest-deep/75 to-forest-deep/45" />
          {/* A teal bloom against the navy — the mark's own pairing. */}
          <div
            className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full opacity-[0.16]"
            style={{ background: 'radial-gradient(circle, #00979c 0%, transparent 70%)' }}
          />
          <div className="absolute inset-y-0 left-[16%] right-0 flex flex-col justify-center p-10 xl:p-14">
            <h2 className="font-display text-paper text-4xl xl:text-[2.75rem] leading-[1.08]">
              The school office, <em className="text-gold-bright not-italic">beautifully</em> in
              order.
            </h2>
            <p className="mt-5 max-w-xs text-paper/70 leading-relaxed text-[15px]">
              Records, attendance, terminal reports and fees — built for private schools in Ghana
              and across Africa.
            </p>
          </div>
        </div>

        {/*
          Form half.
          Narrower than the art panel's 52% on purpose: the chevron's point reaches 48% of the
          card, so a form column any wider puts its right-aligned content — "Forgot password?" —
          underneath the navy and clips it.
        */}
        <section className="relative p-8 sm:p-12 lg:w-[45%] lg:pr-0 lg:py-14 lg:pl-14">
          {/*
            The school, at the top, at size — this is the one screen with nothing else competing
            for attention, and the one most likely to be seen by someone working out whether they
            are in the right place.

            Stacked, not side by side. The form column is 45% of the card, and a crest beside the
            name leaves barely 200px for it — "Sunbeam International School" broke to three lines
            and shoved the form down the page. Above it, the name gets the whole column and the
            arrangement matches the sidebar's, which is the same crest-over-name lockup.
          */}
          <div>
            <SchoolCrest name={schoolName} hasLogo={brand.hasLogo} size={80} pub />
            <h1 className="mt-4 font-display text-[1.75rem] sm:text-[2rem] leading-[1.15] text-ink text-balance">
              {schoolName}
            </h1>
            {brand.motto && (
              <p className="mt-1.5 text-[13px] text-oat italic leading-snug line-clamp-2">
                {brand.motto}
              </p>
            )}
          </div>

          {/* A hairline, not a gap: it separates the school from the task without a heading. */}
          <hr className="mt-7 border-mist" />

          {/*
            Demoted from the h1 it used to be. "Sign in" is what you are doing, not who you are
            visiting, and it was previously set larger than the school's name is now.
          */}
          <h2 className="mt-6 font-display text-xl text-oat">{title}</h2>
          {subtitle && (
            <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-oat">{subtitle}</p>
          )}

          <div className="mt-7">{children}</div>
          {footer && <div className="mt-8">{footer}</div>}

          {/*
            Klasio signs the card, quietly.

            The full lockup, which already carries its own wordmark — setting the emblem beside the
            word "Klasio" said the name twice, once as artwork and once as text. Size is what makes
            it a signature rather than a second brand: it led these pages at 56px and now sits at
            24, under the school's 80px crest.

            It stays on the white half. The artwork was keyed off a white background, so its solid
            areas are only ~90% opaque; on the navy panel it washes out rather than failing
            obviously enough for anyone to notice.
          */}
          <p className="mt-10 flex items-center gap-2.5 text-[12px] text-oat/70">
            <span>Powered by</span>
            <img
              src="/brand/klasio-lockup.png"
              alt="Klasio — School Management System"
              className="h-6 w-auto"
            />
          </p>
        </section>
      </div>
    </main>
  );
}
