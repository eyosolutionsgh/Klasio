import { getMe } from '@/lib/api';

/** Task-shaped rather than feature-shaped: staff arrive here mid-job, not browsing. */
const SECTIONS = [
  {
    title: 'Setting up for a new year',
    steps: [
      'School Setup → add the academic year, then its three terms with the "next term begins" date.',
      'Add your levels (KG, Basic, JHS…), then the classes inside each one, then subjects.',
      'Mark the current year and term — everything else keys off this.',
      'Assign a grading scheme per level: GES classic for Basic and above, proficiency bands or observation scales for early years.',
    ],
  },
  {
    title: 'Enrolling students',
    steps: [
      'Students → Add a student for one at a time, or Import to bring in a class from an Excel template.',
      'The import template is downloadable from the Import page — keep the column headings as they are.',
      'Each student needs at least one guardian with a phone number. That phone is how the parent signs in to the parent portal.',
      'A guardian with more than one child at the school is matched on their phone number, so add them with the same number and they will see all their children.',
    ],
  },
  {
    title: 'Daily attendance',
    steps: [
      'Attendance → pick the class and the date, then mark present, late, absent or excused.',
      'Term totals feed straight onto the terminal report — you do not enter attendance twice.',
    ],
  },
  {
    title: 'Marks and terminal reports',
    steps: [
      'Marks Entry → choose class and subject, enter continuous-assessment and exam scores.',
      'Terminal Reports → Generate for the class. SBA is scaled to 30 and the exam to 70 by default.',
      'Add the class teacher’s remark and, as head, the head’s remark. Then Publish.',
      'Publishing is what releases the report to parents. Unpublishing retracts it immediately.',
    ],
  },
  {
    title: 'Fees',
    steps: [
      'Fee Structure → list what each student is billed this term, then Generate term invoices.',
      'Re-running generation is safe: anyone already billed is skipped, so run it again after enrolling someone new.',
      'Fees → record cash payments, confirm bank deposits against their uploaded proof, or send a parent a payment link.',
      'The ledger is append-only. A correction is a reversal entry, never an edit — so the history always adds up.',
    ],
  },
  {
    title: 'Reaching parents',
    steps: [
      'Announcements → notices that appear on the parent portal.',
      'Messaging → bulk SMS to a class, a level or a custom list. SMS is pay-as-you-go from your credit balance.',
      'Parents sign in at /family with their phone number and a code — no password to forget or reset.',
    ],
  },
];

export default async function GuidePage() {
  const me = await getMe();
  return (
    <div className="max-w-3xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">User guide</h1>
        <p className="text-sm text-oat mt-1.5">How to run a term in {me.school.name} end to end.</p>
      </div>

      <div className="mt-6 space-y-5">
        {SECTIONS.map((s, i) => (
          <section key={s.title} className={`card p-6 rise rise-${Math.min(4, i + 1)}`}>
            <h2 className="font-display text-xl">{s.title}</h2>
            <ol className="mt-3 space-y-2.5">
              {s.steps.map((step, n) => (
                <li key={n} className="flex gap-3 text-sm">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-mist text-brand grid place-items-center text-[11px] font-medium tabular">
                    {n + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
