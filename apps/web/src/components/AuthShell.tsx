import type { ReactNode } from 'react';

/**
 * The frame every sign-in page sits in.
 *
 * One card, floating on a tinted page, split into a form half and an angled art half. The three
 * doors into this product — staff, parent and student — used to look like three different
 * products: one was a full-bleed two-column split, the other two were small centred boxes. They
 * share this now, so a parent who has seen a teacher's screen recognises where they are.
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
  return (
    // No page-level fill: the body's paper grain is the background here, and an opaque tint
    // would sit on top of it.
    <main className="min-h-dvh grid place-items-center p-4 sm:p-8">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(27,40,34,0.35)]">
        {/*
          The accent spans the whole card, above the clip: the clip-path cuts its children, so a
          rule that starts partway across reads as a loose fragment rather than an edge.
        */}
        <div className="accent-rule h-[3px] absolute top-0 left-0 right-0 z-10" />

        {/* Art half. Sits above the form's right margin, so the point lands inside the card. */}
        <div
          aria-hidden
          className="texture-weave hidden lg:block absolute inset-y-0 right-0 w-[52%] bg-forest-deep overflow-hidden"
          style={{ clipPath: 'polygon(16% 0, 100% 0, 100% 100%, 16% 100%, 0 50%)' }}
        >
          {/* The same gold bloom the old sign-in panel carried, kept so the brand still reads. */}
          <div
            className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full opacity-[0.09]"
            style={{ background: 'radial-gradient(circle, #c9982f 0%, transparent 70%)' }}
          />
          <div className="absolute inset-y-0 left-[16%] right-0 flex flex-col justify-center p-10 xl:p-14">
            <h2 className="font-display text-paper text-4xl xl:text-[2.75rem] leading-[1.08]">
              The school office, <em className="text-gold not-italic">beautifully</em> in order.
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
          underneath the green and clips it.
        */}
        <section className="relative p-8 sm:p-12 lg:w-[45%] lg:pr-0 lg:py-16 lg:pl-14">
          <h1 className="font-display text-3xl sm:text-[2.5rem] leading-tight text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-oat">{subtitle}</p>
          )}
          <div className="mt-9">{children}</div>
          {footer && <div className="mt-8">{footer}</div>}
        </section>
      </div>
    </main>
  );
}
