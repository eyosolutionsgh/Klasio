/**
 * The wording of every automatic message, in one catalogue (FEATURES.md §11: "You write the
 * wording of every automatic message").
 *
 * A school edits a row in MessageTemplate; anything it has not edited falls back to the default
 * here. Senders must never hardcode body text — they name a kind and supply the variables, so a
 * school can reword a pickup confirmation without a deploy.
 */

export interface TemplateSpec {
  label: string;
  default: string;
  /** The {placeholders} this kind substitutes at send time. */
  placeholders: string[];
}

export const MESSAGE_TEMPLATES: Record<string, TemplateSpec> = {
  FEE_REMINDER_GENTLE: {
    label: 'Fee reminder — gentle',
    default:
      "{school}: a balance of {amount} remains on {student}'s account. Kindly settle at your convenience. Thank you.",
    placeholders: ['school', 'student', 'amount', 'nextTerm'],
  },
  FEE_REMINDER_FIRM: {
    label: 'Fee reminder — firm',
    default:
      '{school}: {student} has an outstanding balance of {amount}. Kindly settle before the end of term to avoid disruption{nextTerm}. Contact the bursar to arrange payment.',
    placeholders: ['school', 'student', 'amount', 'nextTerm'],
  },
  ABSENCE_ALERT: {
    label: 'Absence alert',
    default:
      '{school}: {student} was marked absent today ({date}). Please contact the school if this is unexpected.',
    placeholders: ['school', 'student', 'date'],
  },
  RESULTS_READY: {
    label: 'Results notification',
    default:
      "{school}: {term} terminal reports are now available. Sign in at the guardian portal with your phone number to view your child's results.",
    placeholders: ['school', 'term'],
  },
  PICKUP_RELEASED: {
    label: 'Pickup confirmation',
    default: '{school}: {student} was collected by {collector} at {time}.',
    placeholders: ['school', 'student', 'collector', 'time'],
  },
  /**
   * The other half of the day. A parent who is told their child left at 15:42 but never told they
   * arrived at 07:14 has been given the less reassuring of the two facts: "did they get there?"
   * is the question a guardian actually carries around all morning.
   */
  DROP_OFF: {
    label: 'Drop-off confirmation',
    default: '{school}: {student} arrived at school at {time}.',
    placeholders: ['school', 'student', 'time'],
  },
};

export type MessageTemplateKind = keyof typeof MESSAGE_TEMPLATES;

/** Substitute {placeholders}; anything unknown is left alone rather than blanked. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

/** The slice of PrismaService these helpers need — kept minimal so unit tests stay cheap. */
interface TemplateDb {
  messageTemplate: {
    findUnique(args: {
      where: { schoolId_kind: { schoolId: string; kind: string } };
    }): Promise<{ body: string } | null>;
    findMany(args: { where: { schoolId: string } }): Promise<{ kind: string; body: string }[]>;
  };
}

/** The body a school has chosen for this kind, or the shipped default. */
export async function templateBody(
  db: TemplateDb,
  schoolId: string,
  kind: MessageTemplateKind,
): Promise<string> {
  const row = await db.messageTemplate.findUnique({
    where: { schoolId_kind: { schoolId, kind } },
  });
  return row?.body ?? MESSAGE_TEMPLATES[kind]?.default ?? '';
}

/** Render an automatic message in the school's own words. */
export async function renderMessage(
  db: TemplateDb,
  schoolId: string,
  kind: MessageTemplateKind,
  vars: Record<string, string>,
): Promise<string> {
  return fillTemplate(await templateBody(db, schoolId, kind), vars);
}

/** Every kind, with the school's override where one exists — the settings page's list. */
export async function listTemplates(db: TemplateDb, schoolId: string) {
  const rows = await db.messageTemplate.findMany({ where: { schoolId } });
  const byKind = new Map(rows.map((r) => [r.kind, r.body]));
  return Object.entries(MESSAGE_TEMPLATES).map(([kind, spec]) => ({
    kind,
    label: spec.label,
    body: byKind.get(kind) ?? spec.default,
    customised: byKind.has(kind),
    placeholders: spec.placeholders,
  }));
}
