import Link from 'next/link';

/**
 * What a page says when the person reaching it may not have it.
 *
 * The menu hides what you cannot open, but a typed URL, an old bookmark or a link pasted into a
 * staff WhatsApp group all arrive anyway — and these screens fetch their data from the browser, so
 * a refusal came back as `res.ok === false` and was quietly skipped. The result was worse than a
 * locked door: an accounts clerk who opened Staff accounts got the whole screen with an empty
 * table reading "No staff accounts yet", which is not a refusal at all, it is a false statement
 * about the school.
 *
 * So say the true thing, and say who can help. No apology, no error styling — being refused a
 * screen you were never given is ordinary, not a fault.
 */
export default function NoAccess({ what }: { what: string }) {
  return (
    <div className="card p-8 max-w-xl rise">
      <h1 className="font-display text-2xl">You do not have access to {what}</h1>
      <p className="text-sm text-oat mt-2 leading-relaxed">
        Your role does not include this. If you need it for your work, ask whoever manages accounts
        at your school — the proprietor, or your system administrator — to add it.
      </p>
      <Link
        href="/dashboard"
        className="inline-block mt-5 text-[13px] text-brand hover:underline underline-offset-2"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
