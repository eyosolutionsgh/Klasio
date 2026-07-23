import Link from 'next/link';
import { getMe } from '@/lib/api';

/**
 * The user guide is task-shaped, not feature-shaped: staff arrive here mid-job, not browsing.
 * It walks a whole term in the order a school runs one — set up, enrol, teach, bill, tell
 * families, account for it — and shows each screen it names.
 *
 * It is also self-scoping. A section is hidden by exactly the rule that hides its menu item, so
 * the guide never teaches a screen this box is not licensed for or this reader may not open —
 * `needs` is the entitlement the feature requires, `holds` the permission its page checks. The
 * proprietor holds everything, which is how the API resolves it too, so the guide agrees with the
 * menu rather than promising a door that is not there.
 */
type Shot = { src: string; alt: string; caption?: string };

interface Section {
  title: string;
  /** Entitlement the feature needs — hidden on a package that does not include it. */
  needs?: string;
  /** Permission the destination page checks — one, or any-of. */
  holds?: string | string[];
  /** One line: what this screen is for. */
  lead: string;
  shots?: Shot[];
  steps?: string[];
  /** A gotcha worth pinning — the kind of thing that is obvious only in hindsight. */
  note?: string;
}

interface Chapter {
  id: string;
  title: string;
  blurb: string;
  sections: Section[];
}

const CHAPTERS: Chapter[] = [
  {
    id: 'getting-around',
    title: 'Getting around',
    blurb: 'Signing in, the shape of the app, and why your menu may be shorter than a colleague’s.',
    sections: [
      {
        title: 'Signing in',
        lead: 'Staff sign in with an email and password; guardians sign in separately with their phone number.',
        shots: [
          {
            src: '/guide/login.webp',
            alt: 'The Klasio sign-in page carrying the school’s crest and name.',
          },
        ],
        steps: [
          'Enter your email address and password, then Log in.',
          'Forgotten it? Forgot password sends a reset by email or SMS — no need to call the office.',
          'The left menu groups the day’s work: Daily, Academic, Finance, Communication and Setup.',
          'You see only what your role allows and what the school’s package includes — a shorter menu is normal, not a fault.',
        ],
        note: 'Every school runs on its own box, licensed to that school alone. The menu hides anything the licence or your role does not cover, so this guide only shows the screens you can actually open.',
      },
      {
        title: 'The dashboard',
        lead: 'The term at a glance the moment you sign in.',
        shots: [
          {
            src: '/guide/dashboard.webp',
            alt: 'Dashboard with headline counts, the term fees position and the notice board.',
          },
        ],
        steps: [
          'Headline counts: pupils enrolled, classes, today’s attendance and fees collected this term.',
          'Fees position shows billed, collected and outstanding for the current term at a glance.',
          'The notice board repeats what families are being told.',
          'Ask your data — type a plain-English question like “which classes are furthest behind on fees?” and get an answer from your own records.',
        ],
      },
    ],
  },
  {
    id: 'setting-up',
    title: 'Setting up for the year',
    blurb:
      'Do these once a year — or once, ever. Everything else keys off them, so it is worth a careful pass.',
    sections: [
      {
        title: 'School setup',
        holds: 'school.settings',
        lead: 'The academic calendar and structure the rest of the app hangs off.',
        shots: [
          {
            src: '/guide/school-setup.webp',
            alt: 'School setup showing admission-number format and terminal report layout.',
          },
        ],
        steps: [
          'Add the academic year, then its three terms — set each term’s “next term begins” date, which prints on every report.',
          'Add your levels (KG, Basic, JHS…), the classes inside each, then the subjects taught.',
          'Mark the current year and term. Bills, attendance and reports all read this one setting.',
          'Assign a grading scheme per level — GES classic for Basic and up, proficiency or observation scales for the early years.',
          'Set your admission-number format and, if it is your policy, the “no fees, no report card” rule.',
        ],
        note: 'Changing the admission-number format never renumbers pupils already enrolled, and the next number can never be set below one already issued.',
      },
      {
        title: 'Profile & branding',
        holds: 'school.branding',
        lead: 'Your crest, colour and contact details — the face of every report, ID card and portal page.',
        shots: [
          {
            src: '/guide/branding.webp',
            alt: 'School profile and branding settings with crest, colour and contact fields.',
          },
        ],
        steps: [
          'Upload your crest — it appears on terminal reports, ID cards and the guardian portal.',
          'Pick your brand colour; the portal and sign-in pages take it up.',
          'Fill in the address, phone and email that print on terminal reports.',
          'Upload the photos each sign-in door shows — defaults ship in the box if you would rather not.',
        ],
      },
      {
        title: 'Records setup',
        holds: 'records.configure',
        lead: 'Extra fields you keep on a pupil, the documents an enrolment must carry, and the remark bank.',
        shots: [
          {
            src: '/guide/records.webp',
            alt: 'Records setup for custom student fields, required documents and remarks.',
          },
        ],
        steps: [
          'Add custom student fields for anything the standard record does not hold.',
          'List the documents every enrolment must carry, so a missing one is visible.',
          'Build the remark bank teachers pick from when writing reports.',
        ],
      },
      {
        title: 'Staff accounts',
        holds: 'users.view',
        lead: 'Who works here, and what each person may do.',
        shots: [{ src: '/guide/staff.webp', alt: 'Staff accounts list with roles.' }],
        steps: [
          'Add a staff member with their email and a role; they set their own password from the invite.',
          'Set someone inactive the day they leave — their sign-in stops at once, including any open session.',
          'Their past entries stay attributed to them in the audit log, so the record is never rewritten.',
        ],
      },
      {
        title: 'Roles & permissions',
        holds: 'roles.manage',
        lead: 'A role is a bundle of permissions; nobody can grant a power they do not themselves hold.',
        shots: [{ src: '/guide/roles.webp', alt: 'Roles and permissions matrix.' }],
        steps: [
          'Start from the preset roles — Owner, Head, Bursar, Teacher, Front desk, Guardian.',
          'Adjust which permissions a role carries to fit how your school divides the work.',
          'Keep duties separate where it matters — the person who records a payment need not be the one who reconciles it.',
        ],
      },
    ],
  },
  {
    id: 'pupils',
    title: 'Pupils and admissions',
    blurb: 'The register, each child’s record, and the road from first enquiry to a seat in class.',
    sections: [
      {
        title: 'Students',
        holds: 'students.view',
        lead: 'The register — every enrolled pupil and their guardians.',
        shots: [
          {
            src: '/guide/students.webp',
            alt: 'The students register listing pupils, classes and guardians.',
          },
        ],
        steps: [
          'Add a student one at a time, or Import a whole class from the downloadable Excel template — keep the column headings as they are.',
          'Each pupil needs at least one guardian with a phone number: that phone is how the guardian signs in to the portal.',
          'A guardian with more than one child is matched on their phone number — add the same number and they see all their children.',
          'Search by name or admission number, and filter by class, status or gender.',
        ],
      },
      {
        title: 'A pupil’s record',
        holds: 'students.view',
        lead: 'Everything about one child, in one place.',
        shots: [
          {
            src: '/guide/student.webp',
            alt: 'A single student record with details, guardians, fees and reports.',
          },
        ],
        steps: [
          'Personal details and any custom fields you added in Records setup.',
          'Guardians, and who may collect the child at dismissal.',
          'Fee position and full payment history, attendance, and terminal reports.',
          'Required documents, flagged when one is missing.',
        ],
      },
      {
        title: 'Admissions',
        needs: 'sis.admissions',
        holds: 'admissions.view',
        lead: 'Applications from first enquiry to enrolment.',
        shots: [
          {
            src: '/guide/admissions.webp',
            alt: 'Admissions pipeline of applicants moving through stages.',
          },
        ],
        steps: [
          'Applicants apply through a link, or you add an enquiry yourself.',
          'Move each applicant through the stages, collecting the required documents as you go.',
          'Admit in one step — it creates the pupil record and issues the next admission number automatically.',
        ],
      },
    ],
  },
  {
    id: 'the-day',
    title: 'The school day',
    blurb: 'The routines that repeat every morning and afternoon.',
    sections: [
      {
        title: 'Attendance',
        holds: 'attendance.view',
        lead: 'The daily register — marked once, and re-used everywhere it is needed.',
        shots: [
          {
            src: '/guide/attendance.webp',
            alt: 'Attendance register with present, late, absent and excused for each pupil.',
          },
        ],
        steps: [
          'Pick the class and the date.',
          'Tap Present, Late, Absent or Excused for each child — or “All present”, then adjust the exceptions.',
          'Save the register. Term totals flow straight onto the terminal report — you never enter attendance twice.',
        ],
        note: 'Staff attendance and longer-run attendance trends sit alongside the pupil register.',
      },
      {
        title: 'Registers',
        holds: [
          'registers.logbook',
          'registers.lesson_notes',
          'registers.duty',
          'registers.discipline',
          'registers.visitors',
          'registers.feeding',
        ],
        lead: 'The statutory books an inspector asks for — kept once, legibly.',
        shots: [
          {
            src: '/guide/registers.webp',
            alt: 'Registers hub for log book, duty roster, visitors, discipline and more.',
          },
        ],
        steps: [
          'Choose the book: log book, duty roster, visitors, discipline, lesson notes or feeding.',
          'Add an entry — each is dated and attributed to whoever wrote it.',
          'The books are the ones a GES or NaSIA visit expects to see, ready to print.',
        ],
      },
      {
        title: 'Dismissal',
        needs: 'safety.pickup',
        holds: 'pickup.view',
        lead: 'Who is collecting each child — checked, and logged.',
        shots: [
          { src: '/guide/pickup.webp', alt: 'Dismissal screen showing who may collect a pupil.' },
        ],
        steps: [
          'Search for the child being collected.',
          'See their approved guardians and delegates — and, in red, anyone BLOCKED from collecting them.',
          'Record the release, noting how the person was identified.',
        ],
        note: 'A BLOCKED person can never be overridden from this screen. Safety is not a judgement call made at the gate.',
      },
      {
        title: 'Transport',
        needs: 'safety.transport',
        holds: ['transport.manage', 'transport.operate'],
        lead: 'Bus routes, who should be on each, and who actually boarded.',
        shots: [{ src: '/guide/transport.webp', alt: 'Transport routes and rider manifest.' }],
        steps: [
          'Build routes and their stops.',
          'Assign riders to a route; the manifest shows who should board.',
          'Boarding scans record who actually got on, morning and afternoon.',
        ],
      },
    ],
  },
  {
    id: 'academic',
    title: 'Teaching and reports',
    blurb: 'From a score in the gradebook to a GES report card in a parent’s hands.',
    sections: [
      {
        title: 'Marks entry',
        holds: ['marks.enter', 'marks.view'],
        lead: 'Continuous-assessment and exam scores, per class and subject.',
        shots: [
          {
            src: '/guide/marks.webp',
            alt: 'Marks entry grid with assessment columns for a class.',
          },
        ],
        steps: [
          'Choose the class and subject.',
          'Add the assessments you use — class tests, project work, end-of-term exam.',
          'Type each pupil’s score and Save. On the report, continuous assessment scales to 30 and the exam to 70.',
        ],
        note: '“Read marks from a photo” can lift a whole column of scores off a marked script — check them, then save.',
      },
      {
        title: 'Terminal reports',
        holds: 'reports.view',
        lead: 'GES report cards, computed from the marks you saved — the product families remember.',
        shots: [
          { src: '/guide/reports.webp', alt: 'Terminal reports list for a class.' },
          {
            src: '/guide/report-card.webp',
            alt: 'A published GES terminal report card.',
            caption:
              'A published report: SBA and exam per subject, grades, class positions and remarks.',
          },
        ],
        steps: [
          'Pick the class and term, then Generate reports — SBA (30%) and exam (70%), GES grades and class positions all computed for you.',
          'Add the class teacher’s remark and, as head, the head’s remark.',
          'Publish to release the report to guardians. Unpublishing retracts it immediately.',
          'Print, or Download PDF, for a paper copy — the broadsheet and BECE/WASSCE outlook sit alongside.',
        ],
        note: 'Publishing is the only thing that releases a report. Until then, a guardian sees nothing.',
      },
      {
        title: 'Timetable',
        needs: 'timetable.core',
        holds: 'timetable.view',
        lead: 'The weekly grid, for a class or for a teacher.',
        shots: [{ src: '/guide/timetable.webp', alt: 'Weekly timetable grid.' }],
        steps: [
          'Select a cell to place a lesson — subject, teacher and room.',
          'A teacher booked in two places at once is caught across the whole day, not just the period.',
          'A draft view, syllabus coverage and substitutions live alongside the live grid.',
        ],
      },
      {
        title: 'Examinations',
        needs: 'exams.cbt',
        holds: ['marks.view', 'assessment.configure'],
        lead: 'Question banks and computer-based tests, marked the moment a pupil submits.',
        shots: [
          {
            src: '/guide/exams.webp',
            alt: 'Examinations screen with question banks and test setup.',
          },
        ],
        steps: [
          'Build a question bank, scoped to a subject and level.',
          'Set a test — choose the bank and class, the minutes and how many questions.',
          'Pupils sit it; scores can post straight into the gradebook. Mock series (BECE/WASSCE) sit under Examinations too.',
        ],
      },
      {
        title: 'Resources',
        needs: 'resources.documents',
        holds: 'resources.view',
        lead: 'Notes and past questions shared with a class, read from home.',
        shots: [{ src: '/guide/resources.webp', alt: 'Learning resources shared with classes.' }],
        steps: [
          'Upload a file — notes, a past paper, a worksheet.',
          'Scope it to the class or level it is for.',
          'Pupils see it in the student portal and can download it at home.',
        ],
      },
    ],
  },
  {
    id: 'money',
    title: 'Fees and money',
    blurb:
      'Billing, collection and accounting — the reason most schools buy software, so it is built to add up.',
    sections: [
      {
        title: 'Fee structure',
        holds: 'fees.structure',
        lead: 'What each pupil is billed, per term.',
        shots: [
          {
            src: '/guide/fee-structure.webp',
            alt: 'Fee structure listing billable items per level.',
          },
        ],
        steps: [
          'List the fee items each level or class is charged this term.',
          'Generate term bills to raise them against every enrolled pupil.',
          'Re-running generation is safe — anyone already billed is skipped, so run it again after a late enrolment.',
          'Scholarships and sibling discounts are set as concessions and post as DISCOUNT entries against the bill.',
        ],
      },
      {
        title: 'Fees',
        holds: 'fees.view',
        lead: 'Billing, collections, and who is likely to fall behind.',
        shots: [
          {
            src: '/guide/fees.webp',
            alt: 'Fees overview with billed, collected, outstanding and a defaulter watch-list.',
          },
        ],
        steps: [
          'Record a cash payment, confirm a bank deposit against its uploaded proof, or send a guardian a payment link.',
          '“Likely to fall behind” flags families from the ledger and reminder history, each with its reasons.',
          'Export the plain ledger, or a double-entry journal, for your accountant.',
        ],
        note: 'The ledger is append-only. A correction is a reversal entry, never an edit — so the history always reconciles, and nothing quietly changes underneath you.',
      },
      {
        title: 'Payment setup',
        needs: 'fees.online',
        holds: 'fees.gateways',
        lead: 'Connect your own Hubtel or Paystack account so guardians can pay online.',
        shots: [{ src: '/guide/gateways.webp', alt: 'Payment gateway connection settings.' }],
        steps: [
          'Paste your gateway keys — the money lands in your account, not ours.',
          'Payment links and portal payments then settle against it automatically.',
        ],
      },
      {
        title: 'Reconciliation',
        needs: 'fees.reconciliation',
        holds: 'fees.reconcile',
        lead: 'Match a gateway’s settlement file against the payments you are holding.',
        shots: [
          { src: '/guide/reconciliation.webp', alt: 'Settlement reconciliation import screen.' },
        ],
        steps: [
          'Import the settlement file the gateway sends.',
          'Matched payments tick off; investigate anything that does not line up.',
        ],
        note: 'Importing a settlement file writes no money — it only reconciles what is already recorded.',
      },
      {
        title: 'Payroll',
        needs: 'hr.payroll',
        holds: 'hr.payroll',
        lead: 'Salaries, SSNIT, PAYE and payslips.',
        shots: [{ src: '/guide/payroll.webp', alt: 'Payroll run screen.' }],
        steps: [
          'Set each staff member’s pay profile once.',
          'Compute the month’s pay run and review the lines.',
          'Issue payslips — with SSNIT and PAYE worked out.',
        ],
      },
    ],
  },
  {
    id: 'families',
    title: 'Reaching families',
    blurb: 'Meet parents where they already are — their phone — and ask them to install nothing.',
    sections: [
      {
        title: 'Announcements',
        holds: 'comms.announce',
        lead: 'Notices that appear on the guardian portal and to staff.',
        shots: [{ src: '/guide/announcements.webp', alt: 'Announcements composer and list.' }],
        steps: [
          'Write the notice.',
          'Scope its audience — the whole school, a level, a single class, or staff only.',
          'It appears on the notice board the moment you post it.',
        ],
      },
      {
        title: 'Calendar',
        holds: 'calendar.view',
        lead: 'Term dates, examinations and school events.',
        shots: [{ src: '/guide/calendar.webp', alt: 'School calendar month view.' }],
        steps: [
          'Add events to the month.',
          'They show to staff and on the guardian portal, so nobody misses a closing date.',
        ],
      },
      {
        title: 'Messaging',
        needs: 'comms.sms',
        holds: 'comms.sms',
        lead: 'Bulk SMS — the channel every parent can receive, feature phone or not.',
        shots: [
          { src: '/guide/messaging.webp', alt: 'SMS messaging composer with recipient selection.' },
        ],
        steps: [
          'Pick your recipients — a class, a level, or a custom list.',
          'Write the message and send. SMS is pay-as-you-go from your credit balance.',
        ],
        note: 'Some messages — fee reminders, absence alerts — can be raised automatically, and never double-send if a job re-runs.',
      },
      {
        title: 'WhatsApp',
        needs: 'comms.whatsapp.templates',
        holds: 'comms.whatsapp',
        lead: 'Replies to families who wrote to the school first.',
        shots: [{ src: '/guide/whatsapp.webp', alt: 'WhatsApp conversations and reply view.' }],
        steps: [
          'A family messages the school’s WhatsApp number; the conversation opens here.',
          'Reply within the window WhatsApp allows.',
          'You cannot start a WhatsApp conversation — for anything unprompted, use SMS.',
        ],
        note: 'This is WhatsApp’s own rule, not a limit of the app: a business may only reply, never cold-message.',
      },
      {
        title: 'Social accounts',
        needs: 'comms.social',
        holds: 'comms.social',
        lead: 'Facebook, Instagram and more — post an announcement straight to them.',
        shots: [{ src: '/guide/social.webp', alt: 'Connected social accounts settings.' }],
        steps: [
          'Connect the school’s page or account.',
          'Choose to cross-post an announcement to it, rather than copying it by hand.',
        ],
      },
      {
        title: 'The guardian portal',
        lead: 'What families see — no app, no password, nothing to install.',
        steps: [
          'Guardians go to /family and sign in with their phone number and a one-time code sent by SMS or email.',
          'They see their children’s published reports, fee position, attendance and the notice board.',
          'The page pins to a phone’s home screen like an app, but it is only a web page — no download, no 40MB, no store.',
        ],
      },
    ],
  },
  {
    id: 'oversight',
    title: 'Oversight and compliance',
    blurb:
      'What the regulator asks for, what you are licensed to run, and a record of everything that changed.',
    sections: [
      {
        title: 'Termly returns',
        needs: 'platform.ges-returns',
        holds: 'returns.view',
        lead: 'The counts GES and NaSIA ask for each term.',
        shots: [
          { src: '/guide/returns.webp', alt: 'Termly returns with per-class candidate counts.' },
        ],
        steps: [
          'Choose the term the return is for.',
          'The figures are reconstructed from that term’s roll — as it was then, not as it is today.',
          'Export or print the return to submit it.',
        ],
      },
      {
        title: 'Licence',
        holds: 'school.settings',
        lead: 'What this school is licensed for, and how to renew.',
        shots: [
          {
            src: '/guide/licence.webp',
            alt: 'Licence screen showing package, features and expiry.',
          },
        ],
        steps: [
          'See your package, the features it switches on, and when it expires.',
          'To renew or change your package, install the new licence file the vendor sends.',
        ],
        note: 'The box runs on this signed file with no call home — your features come from the licence, never from a switch flipped somewhere else. Your package limits features, never how many pupils you may enrol.',
      },
      {
        title: 'Audit log',
        holds: 'audit.view',
        lead: 'Who changed what, and when.',
        shots: [{ src: '/guide/audit.webp', alt: 'Audit log of recorded changes.' }],
        steps: [
          'Every meaningful change is recorded with who made it and when.',
          'Filter the log to trace a record’s history when a question comes up.',
        ],
      },
    ],
  },
];

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-3 space-y-2.5">
      {steps.map((step, n) => (
        <li key={n} className="flex gap-3 text-sm">
          <span className="shrink-0 w-6 h-6 rounded-full bg-brand-mist text-brand grid place-items-center text-[11px] font-medium tabular">
            {n + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Figure({ shot }: { shot: Shot }) {
  return (
    <figure className="mt-4">
      {/* Plain <img>, like the sidebar lockup: these ship in the box and must render offline and
          under a strict CSP, so no next/image loader and no remote host. */}
      <img
        src={shot.src}
        alt={shot.alt}
        loading="lazy"
        className="w-full h-auto rounded-xl border border-mist/60 shadow-sm"
      />
      {shot.caption && (
        <figcaption className="mt-2 text-[12px] text-oat">{shot.caption}</figcaption>
      )}
    </figure>
  );
}

export default async function GuidePage() {
  const me = await getMe();

  const held = new Set(me.permissions ?? []);
  const ent = new Set(me.entitlements ?? []);
  const isOwner = me.user.role === 'OWNER';

  const canSee = (s: Section) => {
    if (s.needs && !ent.has(s.needs)) return false;
    if (s.holds && !isOwner) {
      const codes = Array.isArray(s.holds) ? s.holds : [s.holds];
      if (!codes.some((c) => held.has(c))) return false;
    }
    return true;
  };

  // A chapter with nothing this reader can open is not rendered, and drops out of the contents.
  const chapters = CHAPTERS.map((c) => ({ ...c, sections: c.sections.filter(canSee) })).filter(
    (c) => c.sections.length > 0,
  );

  return (
    <div className="max-w-3xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">User guide</h1>
        <p className="text-sm text-oat mt-1.5">
          How to run a term in {me.school.name} end to end — set up, enrol, teach, bill, tell
          families, and account for it.
        </p>
      </div>

      {/* Contents: only the chapters this reader actually has. */}
      <nav className="card p-5 mt-6 rise rise-2" aria-label="Guide contents">
        <p className="text-[11px] uppercase tracking-widest text-oat">On this page</p>
        <ol className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {chapters.map((c, i) => (
            <li key={c.id} className="flex gap-2.5">
              <span className="shrink-0 text-oat tabular">{i + 1}.</span>
              <a href={`#${c.id}`} className="text-brand hover:underline underline-offset-2">
                {c.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-12">
        {chapters.map((c) => (
          <section key={c.id} id={c.id} className="scroll-mt-24">
            <div className="border-l-2 border-brand pl-4">
              <h2 className="font-display text-2xl">{c.title}</h2>
              <p className="text-sm text-oat mt-1">{c.blurb}</p>
            </div>

            <div className="mt-5 space-y-5">
              {c.sections.map((s) => (
                <article key={s.title} className="card p-6">
                  <h3 className="font-display text-lg">{s.title}</h3>
                  <p className="text-sm text-oat mt-1">{s.lead}</p>

                  {s.shots?.map((shot) => (
                    <Figure key={shot.src} shot={shot} />
                  ))}

                  {s.steps && <StepList steps={s.steps} />}

                  {s.note && (
                    <p className="mt-4 rounded-lg bg-brand-mist/60 px-4 py-3 text-[13px] leading-relaxed text-ink/80">
                      <span className="font-medium text-ink">Good to know — </span>
                      {s.note}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-12 text-sm text-oat">
        Something not covered here?{' '}
        <Link href="/help" className="text-brand underline underline-offset-2">
          Help &amp; support
        </Link>{' '}
        has the common fixes and how to reach us.
      </p>
    </div>
  );
}
