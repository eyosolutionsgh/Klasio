import Link from 'next/link';
import { getMe } from '@/lib/api';

/**
 * The user guide, in four parts: Getting started (orientation), How-to (every workflow, step by
 * step, attributed to the role that performs it), Troubleshooting (the common fixes), and a
 * Feature reference (a tour of every screen).
 *
 * Two things make it trustworthy rather than aspirational. It is **self-scoping**: a how-to or a
 * screen is shown only when the reader's package and permissions could actually reach it — keyed
 * off `needs` (entitlement) and `holds` (permission), the same rules that build the menu, with the
 * proprietor seeing everything. And every screenshot is taken **as the role that does that job**,
 * so the menu in the picture is the shorter, real one that staff member sees — never the
 * proprietor's everything-menu, which would read as "features are missing from mine".
 */
type Shot = { src: string; alt: string; caption?: string };

interface Item {
  title: string;
  /** The role that typically performs this, shown as a chip. */
  who?: string;
  needs?: string;
  holds?: string | string[];
  lead: string;
  shots?: Shot[];
  steps?: string[];
  note?: string;
}
interface Group {
  title?: string;
  items: Item[];
}
interface Part {
  id: string;
  title: string;
  blurb: string;
  /** Gated parts hide items the reader cannot reach; ungated parts show every item. */
  gated: boolean;
  groups: Group[];
}

const PARTS: Part[] = [
  // ─────────────────────────────── GETTING STARTED ───────────────────────────────
  {
    id: 'getting-started',
    title: 'Getting started',
    blurb:
      'Signing in, the shape of the app, who does what, and the one-time setup of a new school.',
    gated: false,
    groups: [
      {
        items: [
          {
            title: 'Signing in',
            lead: 'Three doors, one building: staff, guardians and pupils each sign in their own way.',
            shots: [
              { src: '/guide/login.webp', alt: 'The Klasio sign-in page with the school crest.' },
            ],
            steps: [
              'Staff sign in at the main address with an email and password. Forgot password sends a reset by email or SMS.',
              'Guardians go to /family and sign in with their phone number and a one-time code — no password to forget.',
              'Pupils go to /student and sign in with their admission number and a PIN the school issues.',
              'Everyone lands on a home page built from what they are allowed to see — which is why no two menus look alike.',
            ],
          },
          {
            title: 'The shape of the app',
            lead: 'A left menu grouped by the rhythm of a school day, and a menu that is deliberately yours alone.',
            shots: [
              {
                src: '/guide/role-head.webp',
                alt: 'A Head Teacher’s portal — the menu grouped into Daily, Academic, Finance, Communication and Setup.',
                caption:
                  'A Head Teacher’s view. Every screenshot in this guide is taken as the role that does the job shown.',
              },
            ],
            steps: [
              'The menu groups work as the day runs: Daily, Academic, Finance, Communication, and the Setup you touch once a term.',
              'You see only what your role allows and what the school’s package includes — a shorter menu than a colleague’s is normal, not a fault or a missing feature.',
              'The top-right shows who you are and your role; the foot of the menu shows the school’s package.',
            ],
            note: 'Because each screenshot here is captured as the role that performs that task, the menu in the picture matches the one that staff member actually sees — so a bursar’s screenshots show a bursar’s menu, not the proprietor’s.',
          },
          {
            title: 'Who does what — the roles',
            lead: 'A role is a named bundle of permissions. These are the presets a new school starts with.',
            shots: [
              {
                src: '/guide/roles.webp',
                alt: 'The Roles & Permissions screen listing each preset role and its powers.',
              },
            ],
            steps: [
              'Proprietor — the owner; holds every permission, always, so a mis-set role can never lock the school out of itself.',
              'Head Teacher & Assistant Head — run the school: students, academics, reports and setup. They see the money but do not handle it.',
              'Head of Department, Class Teacher, Subject Teacher — teach: the register, marks, lessons and (for the class teacher) the class remark.',
              'Exams Officer — runs assessment and terminal reports without teaching.',
              'Bursar — the school’s finances: fees, billing, reconciliation, payroll and the canteen. Accounts Clerk takes payments at the counter but cannot change what is owed.',
              'Registrar — enrolment and admissions. Front Desk — dismissal and the visitors’ book. School Nurse — medical notes and boarding welfare. Librarian — learning resources.',
              'System Administrator — staff accounts, roles and settings, without any of the leadership duties.',
            ],
            note: 'These are starting points, not fixed. A head can widen or narrow any role — see “Assign or revoke permissions” under How-to. Each role sees a menu built from only its permissions, which is why no two look alike.',
          },
          {
            title: 'First run: a brand-new school',
            lead: 'The very first visit to a fresh box sets the school up, once.',
            shots: [
              {
                src: '/guide/setup-year.webp',
                alt: 'School setup — admission numbers and academic structure.',
              },
            ],
            steps: [
              'A fresh install opens on /setup, which creates the school and its owner, then closes permanently.',
              'Sign in as the owner and open School Setup: add the academic year and its three terms, then levels, classes and subjects.',
              'Assign a grading scheme per level, set your admission-number format, and add your crest and colour under Profile & Branding.',
              'Create staff accounts and, if the presets do not fit, adjust the roles. Then enrol pupils and you are ready to run a term.',
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────── HOW-TO ───────────────────────────────
  {
    id: 'how-to',
    title: 'How-to',
    blurb:
      'Every workflow, in order, step by step — each headed by the role that usually does it. Only the ones you can reach are shown.',
    gated: true,
    groups: [
      {
        title: 'Once a year',
        items: [
          {
            title: 'Start a new academic year',
            who: 'Head Teacher',
            holds: 'school.settings',
            lead: 'The calendar every bill, register and report reads from.',
            shots: [
              {
                src: '/guide/howto-year.webp',
                alt: 'The years-and-terms editor, with Make current and the Close buttons.',
              },
            ],
            steps: [
              'School Setup → Academic years & terms → Add an academic year with its name and start/end dates.',
              'Add its three terms, each with the “next term begins” date that prints on every terminal report.',
              'Press Make current on the term you are starting. Bills, attendance and reports all follow this one setting.',
            ],
            note: 'Nothing keys off the calendar until a term is marked current, so this is the switch that starts the year.',
          },
          {
            title: 'Promote a class, or graduate the leavers',
            who: 'Head Teacher',
            holds: 'students.lifecycle',
            lead: 'Move a whole class up a year — or send the final year off the roll — in one reviewed step.',
            shots: [
              {
                src: '/guide/howto-promote.webp',
                alt: 'The promote control: choose a class and Promote, or Graduate class.',
              },
            ],
            steps: [
              'Students → choose the class from the filter, then Promote.',
              'To move up: pick the class they move into and confirm. Everyone advances together; hold a child back by moving them individually instead.',
              'To graduate the final year: choose Graduate class and type the count to confirm — graduating cannot be undone with a click.',
            ],
            note: 'Promoting and graduating are the two irreversible lifecycle moves, so both ask for deliberate confirmation. Graduating tidies the roll; it never deletes anyone — their records stay readable and exportable.',
          },
          {
            title: 'Close a term, then close the year',
            who: 'Head Teacher',
            holds: 'school.settings',
            lead: 'Freeze the academic record once the term’s work is signed off.',
            steps: [
              'School Setup → Academic years & terms → Close term on each term as it ends.',
              'Close year once every term inside it is closed — the app refuses while any term is still open, and says which.',
              'Reopening a closed term or year asks for a reason, which is kept.',
            ],
            note: 'Closing a term freezes marks and attendance for it, but never stops you taking fees or publishing that term’s reports.',
          },
        ],
      },
      {
        title: 'Each term',
        items: [
          {
            title: 'Set the fee structure and bill the term',
            who: 'Bursar',
            holds: 'fees.structure',
            lead: 'Decide what each pupil owes, then raise the bills.',
            shots: [
              {
                src: '/guide/howto-billing.webp',
                alt: 'The Generate term bills panel and its button.',
              },
            ],
            steps: [
              'Fee Structure → list the items each level or class is charged this term.',
              'Generate term bills to raise them against every enrolled pupil.',
              'Re-running is safe — anyone already billed is skipped — so run it again after a late enrolment. Scholarships and sibling discounts post as concessions.',
            ],
          },
          {
            title: 'Enter marks',
            who: 'Class or Subject Teacher',
            holds: ['marks.enter', 'marks.view'],
            lead: 'Continuous-assessment and exam scores, per class and subject.',
            shots: [
              {
                src: '/guide/howto-marks.webp',
                alt: 'The score grid — a column of inputs for each assessment.',
              },
            ],
            steps: [
              'Marks Entry → choose the class and the subject.',
              'Add the assessments you use — class tests, project work, the end-of-term exam.',
              'Type each pupil’s score — they save as you go. On the report, continuous assessment scales to 30 and the exam to 70.',
            ],
            note: '“Read marks from a photo” can lift a whole column off a marked script — check the numbers, then save.',
          },
          {
            title: 'Generate and publish terminal reports',
            who: 'Exams Officer',
            holds: 'reports.generate',
            lead: 'The GES report card, computed from the marks and released to families.',
            shots: [
              {
                src: '/guide/howto-reports.webp',
                alt: 'The class and term pickers with the Generate reports button.',
              },
              {
                src: '/guide/report-card.webp',
                alt: 'A published GES terminal report card.',
                caption:
                  'A published report: SBA and exam per subject, grades, positions and remarks.',
              },
            ],
            steps: [
              'Terminal Reports → pick the class and term → Generate. SBA (30%), exam (70%), grades and class positions are all computed.',
              'Add the class teacher’s remark and, as head, the head’s remark.',
              'Publish to release the reports to guardians and pupils. Print or Download PDF for paper copies.',
            ],
            note: 'Publishing is the only thing that releases a report. Unpublishing retracts it immediately; regenerating a published report asks first.',
          },
          {
            title: 'File the termly returns',
            who: 'Head Teacher',
            needs: 'platform.ges-returns',
            holds: 'returns.view',
            lead: 'The counts GES and NaSIA ask for, reconstructed for the term.',
            shots: [
              {
                src: '/guide/howto-returns.webp',
                alt: 'The termly-returns table of per-class counts.',
              },
            ],
            steps: [
              'Termly Returns → choose the term the return is for.',
              'The figures are rebuilt from that term’s roll as it was then, not as it is today.',
              'Export or print the return to submit it.',
            ],
          },
        ],
      },
      {
        title: 'Every day',
        items: [
          {
            title: 'Enrol a student',
            who: 'Registrar',
            holds: 'students.create',
            lead: 'One at a time, or a whole class from a spreadsheet.',
            shots: [
              {
                src: '/guide/howto-enrol.webp',
                alt: 'The register toolbar: Add student, Import and Export.',
              },
            ],
            steps: [
              'Students → Add a student, or Import a class from the downloadable Excel template (keep the column headings).',
              'Give each pupil at least one guardian with a phone number — that phone is how the guardian signs in.',
              'A guardian with several children is matched on their phone, so use the same number and they see all their children.',
            ],
          },
          {
            title: 'Move an applicant to enrolment',
            who: 'Registrar',
            needs: 'sis.admissions',
            holds: 'admissions.manage',
            lead: 'From first enquiry to a seat in class.',
            steps: [
              'Admissions → move each applicant through the stages, collecting the required documents.',
              'Admit in one step — it creates the pupil record and issues the next admission number automatically.',
            ],
          },
          {
            title: 'Mark attendance',
            who: 'Class Teacher',
            holds: 'attendance.mark',
            lead: 'The daily register — marked once, re-used on the report.',
            shots: [
              {
                src: '/guide/howto-attendance.webp',
                alt: 'A roster row with Present, Late, Absent and Excused, and the Save register button.',
              },
            ],
            steps: [
              'Attendance → pick the class and the date.',
              'Tap Present, Late, Absent or Excused for each child — or “All present”, then fix the exceptions.',
              'Save. The term totals flow straight onto the terminal report; you never enter attendance twice.',
            ],
          },
          {
            title: 'Record a payment or confirm a deposit',
            who: 'Accounts Clerk or Bursar',
            holds: 'fees.record_payment',
            lead: 'Money in, at the counter or from the bank.',
            shots: [
              {
                src: '/guide/howto-payment.webp',
                alt: 'The Record payment dialog: amount, method, and Record & issue receipt.',
              },
            ],
            steps: [
              'Fees → record a cash payment, confirm a bank deposit against its uploaded proof, or send a guardian a payment link.',
              'The “Likely to fall behind” list flags families with reasons; export the ledger or double-entry journal for your accountant.',
            ],
            note: 'The ledger is append-only. A correction is a reversal that points at what it cancels, never an edit — so the history always reconciles.',
          },
          {
            title: 'Reach families',
            who: 'Bursar or Head Teacher',
            holds: ['comms.sms', 'comms.announce'],
            lead: 'A notice on the portal, or a text to every phone.',
            shots: [
              {
                src: '/guide/howto-messaging.webp',
                alt: 'The SMS composer, with recipients and the Send button.',
              },
              {
                src: '/guide/howto-announce.webp',
                alt: 'The announcement composer: title, message and audience.',
              },
            ],
            steps: [
              'Messaging → pick recipients (a class, a level, a custom list), write the message, and send. SMS is pay-as-you-go from your credit.',
              'Announcements → write a notice and scope its audience; it appears on the guardian and pupil portals.',
            ],
            note: 'Some messages — fee reminders, absence alerts — can be raised automatically, and never double-send if a job re-runs.',
          },
          {
            title: 'Log dismissal safely',
            who: 'Front Desk',
            needs: 'safety.pickup',
            holds: 'pickup.view',
            lead: 'Who is collecting each child — checked, and recorded.',
            steps: [
              'Dismissal → search for the child being collected.',
              'See their approved guardians and delegates, and — in red — anyone BLOCKED from collecting them.',
              'Record the release, noting how the person was identified.',
            ],
            note: 'A BLOCKED person can never be overridden here. Safety is not a judgement call made at the gate.',
          },
          {
            title: 'Keep the registers',
            who: 'Front Desk',
            holds: ['registers.logbook', 'registers.visitors', 'registers.discipline'],
            lead: 'The statutory books an inspector expects, kept legibly.',
            shots: [
              {
                src: '/guide/howto-registers.webp',
                alt: 'A register entry form.',
              },
            ],
            steps: [
              'Registers → choose the book: log book, duty roster, visitors, discipline, lesson notes or feeding.',
              'Add an entry — each is dated and attributed to whoever wrote it, and cannot be quietly changed later.',
            ],
          },
        ],
      },
      {
        title: 'Boarding, canteen and lessons',
        items: [
          {
            title: 'Run the boarding house',
            who: 'Head Teacher or Matron',
            needs: 'housing.boarding',
            holds: 'housing.manage',
            lead: 'Houses and beds, and the exeat book.',
            shots: [
              {
                src: '/guide/howto-boarding.webp',
                alt: 'The exeat sign-out form: boarder, reason, destination and due-back.',
              },
            ],
            steps: [
              'Boarding → Add a house (boys, girls or mixed) and, if you like, its house master or matron.',
              'Add rooms with a number of beds, then Assign a boarder by searching for a pupil — a full room refuses another.',
              'In the exeat book, sign a boarder out with a reason and a return time, and sign them back in when they arrive.',
            ],
            note: 'One bed per boarder is enforced, and the exeat book shows at a glance who is out and who is overdue back.',
          },
          {
            title: 'Run the canteen till',
            who: 'Accounts Clerk',
            needs: 'canteen.wallet',
            holds: 'canteen.manage',
            lead: 'A prepaid wallet per pupil, topped up and spent at the counter.',
            shots: [
              {
                src: '/guide/howto-canteen.webp',
                alt: 'The counter: a pupil’s balance with Top up and Record spend.',
              },
            ],
            steps: [
              'Canteen → At the counter → find a pupil by name or admission number.',
              'Take a Top up, or Record spend for a lunch. The wallet list shows the lowest balances first.',
              'A mistake is a Reverse on the entry, never an edit.',
            ],
            note: 'A spend can never take the balance below zero, and the balance is derived from an append-only ledger — exactly like fees.',
          },
          {
            title: 'Publish a lesson and grade homework',
            who: 'Class or Subject Teacher',
            needs: 'lms.core',
            holds: 'lms.manage',
            lead: 'Beyond a shared file: work handed in from home, and marked.',
            shots: [
              {
                src: '/guide/howto-lms.webp',
                alt: 'The Set assignment form: title, instructions, due date and marks.',
              },
              {
                src: '/guide/student-lms.webp',
                alt: 'The pupil’s side — an assignment to submit and a graded one.',
                caption:
                  'The pupil’s side: work is submitted from home, and the mark returns once graded.',
              },
            ],
            steps: [
              'Lessons → pick a class → Publish a lesson, or Set an assignment with a due date and marks.',
              'Pupils read it and submit from the student portal at home.',
              'Open an assignment to see the submissions, then Save a mark and feedback.',
            ],
            note: 'A pupil can resubmit until you grade the work; once graded it is locked, and the mark and feedback show on their side.',
          },
        ],
      },
      {
        title: 'Managing access',
        items: [
          {
            title: 'Add a staff member',
            who: 'System Administrator',
            holds: 'users.manage',
            lead: 'A new account, and closing one cleanly.',
            shots: [{ src: '/guide/howto-staff.webp', alt: 'The add-staff form.' }],
            steps: [
              'Staff Accounts → Add a staff member with their email and a role. They set their own password from the invite.',
              'Set someone inactive the day they leave — their sign-in stops at once, including any open session.',
              'Their past entries stay attributed to them in the audit log, so the record is never rewritten.',
            ],
          },
          {
            title: 'Assign or revoke permissions',
            who: 'System Administrator',
            holds: 'roles.manage',
            lead: 'Tune what a role may do, or move a power from one person to another.',
            shots: [
              {
                src: '/guide/howto-roles.webp',
                alt: 'The roles matrix — each role with a ⋯ menu to edit its permissions.',
              },
            ],
            steps: [
              'Roles & Permissions → pick a role → tick the permissions to grant and untick the ones to remove, then save.',
              'Assign the role to a person on Staff Accounts. Change takes effect on their next action.',
              'To revoke, untick the permission or move the person to a narrower role.',
            ],
            note: 'Nobody can grant a permission they do not themselves hold, and money duties are kept separate on purpose — the person who records a payment need not be the one who reconciles it.',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────── TROUBLESHOOTING ───────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    blurb: 'The questions the office asks most, with the fix.',
    gated: false,
    groups: [
      {
        items: [
          {
            title: 'My menu is shorter than a colleague’s.',
            lead: 'That is by design, not a fault.',
            steps: [
              'The menu shows only what your role allows and what the school’s package includes.',
              'If you genuinely need a screen you cannot see, ask whoever manages roles to widen yours — see “Assign or revoke permissions”.',
            ],
          },
          {
            title: 'A guardian cannot sign in.',
            lead: 'Almost always the phone number, or SMS credit.',
            steps: [
              'Check the phone number on the child’s record matches the one they are typing — any format works, but it must be the same number.',
              'If it is right and no code arrives, the school’s SMS credit may be exhausted; top it up under Messaging.',
            ],
          },
          {
            title: 'A guardian or pupil cannot see a report.',
            lead: 'Reports appear only once published.',
            steps: [
              'Open Terminal Reports, confirm the class and term, and check the report shows as published.',
              'If your school withholds reports over unpaid fees, the family sees an explanation rather than the report until the balance clears.',
            ],
          },
          {
            title: 'Someone was billed twice, or not at all.',
            lead: 'Re-running is safe; a wrong amount is a reversal.',
            steps: [
              'Generating term bills skips anyone already billed, so running it again after a late enrolment cannot double-bill.',
              'If an amount is genuinely wrong, record a reversal rather than editing — the ledger is append-only and must always add up.',
            ],
          },
          {
            title: 'A canteen balance looks wrong.',
            lead: 'The same append-only rule as fees.',
            steps: [
              'Every top-up and spend is a ledger entry; reverse the wrong one rather than editing it.',
              'The balance recomputes from the ledger, so a reversal restores it exactly.',
            ],
          },
          {
            title: 'A member of staff has left.',
            lead: 'Set them inactive.',
            steps: [
              'Staff Accounts → set them inactive. Their sign-in stops immediately, including any session already open.',
              'Their past entries stay attributed to them in the audit log.',
            ],
          },
          {
            title: 'I forgot my password.',
            lead: 'Reset it from the sign-in page.',
            steps: [
              'Forgot password on the sign-in page sends a reset link by email or SMS — no need to call the office.',
            ],
          },
          {
            title: 'How many students can we enrol?',
            lead: 'As many as you have.',
            steps: [
              'Your package decides which features are switched on, never how big your school may be.',
              'A new intake never needs a licence change; withdrawing or graduating a child keeps the register tidy and their record readable.',
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────── FEATURE REFERENCE ───────────────────────────────
  {
    id: 'reference',
    title: 'Feature reference',
    blurb:
      'A short tour of every screen, in menu order. Only the ones your school and role can open are listed.',
    gated: true,
    groups: [
      {
        title: 'Daily',
        items: [
          {
            title: 'Dashboard',
            lead: 'The term at a glance the moment you sign in — headline counts, the fees position, the notice board, and a plain-English question box over your own data.',
            shots: [
              {
                src: '/guide/role-bursar.webp',
                alt: 'A bursar’s dashboard.',
                caption: 'A bursar’s dashboard — the cards and menu they see.',
              },
            ],
          },
          {
            title: 'Students',
            holds: 'students.view',
            lead: 'The register: every enrolled pupil and their guardians, searchable and filterable, with Add, Import and Export.',
            shots: [{ src: '/guide/students.webp', alt: 'The students register.' }],
          },
          {
            title: 'A pupil’s record',
            holds: 'students.view',
            lead: 'Everything about one child in one place — details and custom fields, guardians and who may collect them, fees and payment history, attendance, reports and documents.',
            shots: [{ src: '/guide/student-detail.webp', alt: 'A single student’s record.' }],
          },
          {
            title: 'Admissions',
            needs: 'sis.admissions',
            holds: 'admissions.view',
            lead: 'Applications from first enquiry to enrolment, moving through stages and collecting documents.',
            shots: [{ src: '/guide/admissions.webp', alt: 'The admissions pipeline.' }],
          },
          {
            title: 'Attendance',
            holds: 'attendance.view',
            lead: 'The daily register, plus staff attendance and longer-run trends. Marked totals flow onto the terminal report.',
            shots: [{ src: '/guide/attendance.webp', alt: 'The attendance register.' }],
          },
          {
            title: 'Registers',
            holds: [
              'registers.logbook',
              'registers.visitors',
              'registers.discipline',
              'registers.duty',
              'registers.lesson_notes',
              'registers.feeding',
            ],
            lead: 'The six statutory books — log book, duty roster, visitors, discipline, lesson notes and feeding — dated and attributed.',
            shots: [{ src: '/guide/registers.webp', alt: 'The registers hub.' }],
          },
          {
            title: 'Dismissal',
            needs: 'safety.pickup',
            holds: 'pickup.view',
            lead: 'Who is collecting each child, checked against approved collectors and blocks, and logged.',
            shots: [{ src: '/guide/pickup.webp', alt: 'The dismissal screen.' }],
          },
          {
            title: 'Transport',
            needs: 'safety.transport',
            holds: ['transport.manage', 'transport.operate'],
            lead: 'Bus routes and stops, who rides each, and boarding scans, morning and afternoon.',
            shots: [{ src: '/guide/transport.webp', alt: 'Transport routes and manifest.' }],
          },
          {
            title: 'Boarding',
            needs: 'housing.boarding',
            holds: ['housing.view', 'housing.manage'],
            lead: 'Houses, rooms and beds, who sleeps where, and the exeat book of boarders signed out and back in.',
            shots: [{ src: '/guide/boarding.webp', alt: 'The boarding screen.' }],
          },
        ],
      },
      {
        title: 'Academic',
        items: [
          {
            title: 'Marks Entry',
            holds: ['marks.enter', 'marks.view'],
            lead: 'Continuous-assessment and exam scores per class and subject; SBA scales to 30 and the exam to 70 on the report.',
            shots: [{ src: '/guide/marks.webp', alt: 'The marks-entry grid.' }],
          },
          {
            title: 'Timetable',
            needs: 'timetable.core',
            holds: 'timetable.view',
            lead: 'The weekly grid for a class or a teacher, with clash-checking, a draft view, syllabus coverage and substitutions.',
            shots: [{ src: '/guide/timetable.webp', alt: 'The weekly timetable grid.' }],
          },
          {
            title: 'Terminal Reports',
            holds: 'reports.view',
            lead: 'GES report cards computed from saved marks, with remarks, positions, the broadsheet and a BECE/WASSCE outlook.',
            shots: [{ src: '/guide/report-card.webp', alt: 'A published terminal report.' }],
          },
          {
            title: 'Examinations',
            needs: 'exams.cbt',
            holds: ['marks.view', 'assessment.configure'],
            lead: 'Question banks and computer-based tests, marked the moment a pupil submits, plus BECE/WASSCE mock series.',
            shots: [{ src: '/guide/exams.webp', alt: 'The examinations screen.' }],
          },
          {
            title: 'Resources',
            needs: 'resources.documents',
            holds: 'resources.view',
            lead: 'Notes and past questions shared with a class; pupils read them from home in the student portal.',
            shots: [
              { src: '/guide/resources.webp', alt: 'Learning resources shared with classes.' },
            ],
          },
          {
            title: 'Lessons',
            needs: 'lms.core',
            holds: ['lms.view', 'lms.manage'],
            lead: 'A step beyond the library: lessons published to a class, assignments with due dates, and graded submissions.',
            shots: [{ src: '/guide/lms.webp', alt: 'The lessons and assignments screen.' }],
          },
        ],
      },
      {
        title: 'Finance',
        items: [
          {
            title: 'Fees',
            holds: 'fees.view',
            lead: 'Billing, collection and the defaulter watch-list, with exports for your accountant. The ledger is append-only.',
            shots: [{ src: '/guide/fees.webp', alt: 'The fees overview.' }],
          },
          {
            title: 'Fee Structure',
            holds: 'fees.structure',
            lead: 'What each pupil is billed per term, and the button that raises the term’s bills.',
            shots: [{ src: '/guide/fee-structure.webp', alt: 'The fee structure.' }],
          },
          {
            title: 'Canteen',
            needs: 'canteen.wallet',
            holds: ['canteen.view', 'canteen.manage'],
            lead: 'A prepaid wallet per pupil on an append-only ledger — top-ups, spending, and who is running low.',
            shots: [{ src: '/guide/canteen.webp', alt: 'The canteen wallet screen.' }],
          },
          {
            title: 'Payroll',
            needs: 'hr.payroll',
            holds: 'hr.payroll',
            lead: 'Salaries, SSNIT and PAYE worked out, pay runs computed, and payslips issued.',
            shots: [{ src: '/guide/payroll.webp', alt: 'The payroll screen.' }],
          },
          {
            title: 'Payment Setup',
            needs: 'fees.online',
            holds: 'fees.gateways',
            lead: 'Connect your own Hubtel or Paystack account so guardians can pay online, into your account.',
            shots: [{ src: '/guide/gateways.webp', alt: 'Payment gateway settings.' }],
          },
          {
            title: 'Reconciliation',
            needs: 'fees.reconciliation',
            holds: 'fees.reconcile',
            lead: 'Match a gateway’s settlement file against the payments you hold. Importing reconciles; it writes no money.',
            shots: [{ src: '/guide/reconciliation.webp', alt: 'Settlement reconciliation.' }],
          },
        ],
      },
      {
        title: 'Communication',
        items: [
          {
            title: 'Announcements',
            holds: 'comms.announce',
            lead: 'Notices scoped to the whole school, a level, a class or staff, shown on the portals.',
            shots: [{ src: '/guide/announcements.webp', alt: 'The announcements screen.' }],
          },
          {
            title: 'Calendar',
            holds: 'calendar.view',
            lead: 'Term dates, examinations and events, shown to staff and on the guardian portal.',
            shots: [{ src: '/guide/calendar.webp', alt: 'The school calendar.' }],
          },
          {
            title: 'Messaging',
            needs: 'comms.sms',
            holds: 'comms.sms',
            lead: 'Bulk SMS to a class, a level or a custom list — the channel every parent can receive, pay-as-you-go.',
            shots: [{ src: '/guide/messaging.webp', alt: 'The SMS messaging screen.' }],
          },
          {
            title: 'WhatsApp',
            needs: 'comms.whatsapp.templates',
            holds: 'comms.whatsapp',
            lead: 'Replies to families who wrote to the school first — by WhatsApp’s own rule, a business may only reply, never cold-message.',
            shots: [{ src: '/guide/whatsapp.webp', alt: 'The WhatsApp conversations screen.' }],
          },
          {
            title: 'Social Accounts',
            needs: 'comms.social',
            holds: 'comms.social',
            lead: 'Connect Facebook, Instagram and more, and cross-post an announcement straight to them.',
            shots: [{ src: '/guide/social.webp', alt: 'Connected social accounts.' }],
          },
        ],
      },
      {
        title: 'Setup & oversight',
        items: [
          {
            title: 'School Setup',
            holds: 'school.settings',
            lead: 'The academic year and terms, levels, classes and subjects, admission-number format and report layout.',
            shots: [{ src: '/guide/setup-year.webp', alt: 'School setup.' }],
          },
          {
            title: 'Profile & Branding',
            holds: 'school.branding',
            lead: 'Your crest, colour and contact details — the face of every report, ID card and portal page.',
            shots: [{ src: '/guide/branding.webp', alt: 'School profile and branding.' }],
          },
          {
            title: 'Records Setup',
            holds: 'records.configure',
            lead: 'Extra fields you keep on a pupil, the documents an enrolment must carry, and the remark bank.',
            shots: [{ src: '/guide/records.webp', alt: 'Records setup.' }],
          },
          {
            title: 'Staff Accounts',
            holds: 'users.view',
            lead: 'Who works here and what each may do; set someone inactive the day they leave.',
            shots: [{ src: '/guide/staff.webp', alt: 'Staff accounts.' }],
          },
          {
            title: 'Roles & Permissions',
            holds: 'roles.manage',
            lead: 'Each role is a bundle of permissions the school can edit; nobody can grant a power they do not hold.',
            shots: [{ src: '/guide/roles.webp', alt: 'Roles and permissions.' }],
          },
          {
            title: 'Termly Returns',
            needs: 'platform.ges-returns',
            holds: 'returns.view',
            lead: 'The counts GES and NaSIA ask for each term, reconstructed as-at that term.',
            shots: [{ src: '/guide/returns.webp', alt: 'Termly returns.' }],
          },
          {
            title: 'Licence',
            holds: 'school.settings',
            lead: 'What this school is licensed for and when it expires; install a renewal file to change your package.',
            shots: [{ src: '/guide/licence.webp', alt: 'The licence screen.' }],
            note: 'The box runs on this signed file with no call home — features come from the licence, and the package limits features, never headcount.',
          },
          {
            title: 'Audit Log',
            holds: 'audit.view',
            lead: 'Who changed what, and when — every meaningful change, filterable to trace a record’s history.',
            shots: [{ src: '/guide/audit.webp', alt: 'The audit log.' }],
          },
        ],
      },
      {
        title: 'The family and pupil portals',
        items: [
          {
            title: 'The guardian portal',
            lead: 'No app, no password: guardians sign in at /family with their phone and a one-time code, and see each child’s reports, fees, attendance, notices and the pickup queue.',
            shots: [{ src: '/guide/family.webp', alt: 'The guardian portal.' }],
          },
          {
            title: 'The pupil portal',
            lead: 'Pupils sign in at /student with their admission number and PIN, and see their results, tests, and lesson notes and assignments to hand in.',
            shots: [
              { src: '/guide/student-home.webp', alt: 'The pupil’s home page.' },
              { src: '/guide/student-lms.webp', alt: 'The pupil’s lessons and assignments.' },
            ],
          },
        ],
      },
    ],
  },
];

function StepList({ steps, ordered }: { steps: string[]; ordered: boolean }) {
  if (ordered) {
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
  return (
    <ul className="mt-3 space-y-1.5">
      {steps.map((step, n) => (
        <li key={n} className="flex gap-2.5 text-sm">
          <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-brand/60" />
          <span>{step}</span>
        </li>
      ))}
    </ul>
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

  const canSee = (item: Item) => {
    if (item.needs && !ent.has(item.needs)) return false;
    if (item.holds && !isOwner) {
      const codes = Array.isArray(item.holds) ? item.holds : [item.holds];
      if (!codes.some((c) => held.has(c))) return false;
    }
    return true;
  };

  // Filter gated parts down to what this reader can reach; drop empty groups and empty parts.
  const parts = PARTS.map((part) => {
    const groups = part.groups
      .map((g) => ({ ...g, items: part.gated ? g.items.filter(canSee) : g.items }))
      .filter((g) => g.items.length > 0);
    return { ...part, groups };
  }).filter((p) => p.groups.length > 0);

  return (
    <div className="max-w-5xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">User guide</h1>
        <p className="text-sm text-oat mt-1.5">
          How to run {me.school.name} end to end. Each screen is shown as the role that uses it, and
          only the parts you can reach are listed.
        </p>
      </div>

      {/*
        The contents float alongside the guide as a sticky left rail from `lg`; below that they
        stack above the content, so a phone still gets a table of contents without a side column.
        `lg:items-start` keeps the rail its natural height so `sticky` actually sticks.
      */}
      <div className="mt-8 lg:flex lg:gap-10 lg:items-start">
        <nav
          className="mb-8 lg:mb-0 lg:sticky lg:top-24 lg:w-44 lg:shrink-0 rise rise-2"
          aria-label="Guide contents"
        >
          <p className="text-[11px] uppercase tracking-widest text-oat">On this page</p>
          <ol className="mt-3 space-y-2 text-sm">
            {parts.map((p, i) => (
              <li key={p.id} className="flex gap-2.5">
                <span className="shrink-0 text-oat tabular">{i + 1}.</span>
                <a href={`#${p.id}`} className="text-brand hover:underline underline-offset-2">
                  {p.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 flex-1 lg:max-w-3xl">
          <div className="space-y-14">
            {parts.map((part) => (
              <section key={part.id} id={part.id} className="scroll-mt-24">
                <div className="border-l-2 border-brand pl-4">
                  <h2 className="font-display text-2xl">{part.title}</h2>
                  <p className="text-sm text-oat mt-1">{part.blurb}</p>
                </div>

                <div className="mt-6 space-y-8">
                  {part.groups.map((group, gi) => (
                    <div key={group.title ?? gi}>
                      {group.title && (
                        <h3 className="text-[11px] uppercase tracking-widest text-oat mb-3">
                          {group.title}
                        </h3>
                      )}
                      <div className="space-y-5">
                        {group.items.map((item) => (
                          <article key={item.title} className="card p-6">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <h4 className="font-display text-lg">{item.title}</h4>
                              {item.who && (
                                <span className="shrink-0 rounded-full bg-brand-mist text-brand text-[11px] font-medium px-2.5 py-1">
                                  {item.who}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-oat mt-1">{item.lead}</p>

                            {item.shots?.map((shot) => (
                              <Figure key={shot.src} shot={shot} />
                            ))}

                            {item.steps && (
                              <StepList steps={item.steps} ordered={part.id === 'how-to'} />
                            )}

                            {item.note && (
                              <p className="mt-4 rounded-lg bg-brand-mist/60 px-4 py-3 text-[13px] leading-relaxed text-ink/80">
                                <span className="font-medium text-ink">Good to know — </span>
                                {item.note}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-12 text-sm text-oat">
            Still stuck?{' '}
            <Link href="/help" className="text-brand underline underline-offset-2">
              Help &amp; support
            </Link>{' '}
            has how to reach us.
          </p>
        </div>
      </div>
    </div>
  );
}
