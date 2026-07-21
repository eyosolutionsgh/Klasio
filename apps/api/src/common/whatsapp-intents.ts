/**
 * The WhatsApp assistant's set list (FEATURES.md §12).
 *
 * Deterministic keyword matching, on purpose: the assistant "answers a set list of questions —
 * anything outside that list goes to a person rather than being guessed at". Free-text
 * understanding beyond this list is §21's AI layer, which sits ON TOP of these intents and
 * degrades back to them when no model is configured.
 *
 * Matching is case-insensitive and forgiving of the way people actually type on WhatsApp
 * ("Owing?", "bal", "my child is sick today"), but never clever: when in doubt it answers with
 * the menu, and a person is always one message away.
 */

export type WhatsAppIntent =
  | 'MENU'
  | 'BALANCE'
  | 'RESULTS'
  | 'ATTENDANCE'
  | 'REPORT_ABSENCE'
  | 'PICKUP_CHANGE'
  | 'NOTICES'
  | 'HUMAN'
  | 'UNKNOWN';

interface Rule {
  intent: WhatsAppIntent;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    intent: 'HUMAN',
    patterns: [
      /\b(speak|talk|chat)\b.*\b(someone|somebody|person|human|staff|teacher|office|admin)\b/,
      /\bcall me\b/,
      /\bagent\b/,
      /\bhelp ?desk\b/,
    ],
  },
  {
    intent: 'BALANCE',
    patterns: [
      /\b(owe|owing|balance|bal|arrears|outstanding)\b/,
      /\bhow much\b.*\b(fees?|pay)\b/,
      /\bschool ?fees?\b/,
      /\bstatement\b/,
    ],
  },
  {
    intent: 'RESULTS',
    patterns: [
      /\b(results?|report ?cards??|terminal report|grades?|position|exams? results?)\b/,
      /\bcome out\b/,
    ],
  },
  {
    intent: 'REPORT_ABSENCE',
    patterns: [
      /\b(sick|unwell|ill|not coming|won'?t come|can'?t come|absent today|not attend)\b/,
      /\bstay(ing)? home\b/,
      /\bhospital\b/,
    ],
  },
  {
    intent: 'ATTENDANCE',
    patterns: [/\b(absent|absence|attendance|present|missed school|marked)\b/],
  },
  {
    intent: 'PICKUP_CHANGE',
    patterns: [
      /\b(collect|pick(ing)? ?up|pick (him|her|them)|fetch)\b/,
      /\b(sister|brother|aunt|uncle|driver|grand(ma|pa|mother|father)|neighbou?r)\b.*\b(today|collect|pick)\b/,
    ],
  },
  {
    intent: 'NOTICES',
    patterns: [
      /\b(notice|announcement|events?|calendar|happening|term dates?|holidays?|vacation|reopen)\b/,
      /\bwhat'?s on\b/,
    ],
  },
  {
    intent: 'MENU',
    patterns: [/^(hi|hello|hey|good (morning|afternoon|evening)|menu|start|options?|help)\b/],
  },
];

export function classifyMessage(raw: string): WhatsAppIntent {
  const text = raw.trim().toLowerCase();
  if (!text) return 'UNKNOWN';
  // Order matters: "I want to speak to someone about the results" is a handoff, not results —
  // the person asked for a person.
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.intent;
  }
  return 'UNKNOWN';
}

/** A bare number replying to a numbered prompt — ward selection. */
export function pickNumber(raw: string, max: number): number | null {
  const m = raw.trim().match(/^(\d{1,2})\.?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= max ? n : null;
}

export function menuText(schoolName: string): string {
  return [
    `You're chatting with ${schoolName}'s assistant. I can help with:`,
    '',
    '1. Fee balance',
    '2. Terminal results',
    '3. Attendance record',
    '4. Report my child absent today',
    '5. Someone different is collecting today',
    "6. Notices & what's coming up",
    '7. Speak to a person',
    '',
    'Reply with a number or just ask.',
  ].join('\n');
}

/** The numbered menu maps straight onto intents, so "4" works as well as "my child is sick". */
export function menuChoice(raw: string): WhatsAppIntent | null {
  const n = pickNumber(raw, 7);
  if (n === null) return null;
  return (
    [
      'BALANCE',
      'RESULTS',
      'ATTENDANCE',
      'REPORT_ABSENCE',
      'PICKUP_CHANGE',
      'NOTICES',
      'HUMAN',
    ] as const
  )[n - 1];
}
