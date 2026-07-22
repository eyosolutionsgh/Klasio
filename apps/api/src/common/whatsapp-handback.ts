/**
 * Giving the assistant back control of a thread.
 *
 * When a family asks for a person the bot goes quiet and stays quiet — deliberately, because the
 * family has been told a human will reply and an assistant chiming in over that conversation
 * would be worse than useless. But it never woke up again either, so a family that once asked for
 * the head then had to wait on a human for "what is my balance?" forever after.
 *
 * The school ends the handoff itself, by saying so in the reply. Not a timer and not "when the
 * school replies": a member of staff is the only one who knows whether the matter is actually
 * settled, and an assistant that jumped back in mid-conversation because a timer expired is the
 * exact failure this pause exists to prevent.
 *
 * ## The rule
 *
 * The command must stand alone at the start or the end of the reply — `/bot`, or a phrase like
 * "back to the assistant". Anything containing it in passing ("I'll ask the bot to send it") does
 * not count, because a member of staff explaining what the assistant does must not accidentally
 * wake it. Whatever text remains is what the family receives, so both of these work:
 *
 *     "/bot"                                  → hands back, family is sent nothing
 *     "The PTA meets Friday 3pm. /bot"        → family gets the sentence, then the bot resumes
 */

/**
 * Recognised commands, longest first so "back to the assistant" is matched before "assistant".
 * Deliberately short and few: a list nobody can remember is a feature nobody uses.
 */
export const HANDBACK_COMMANDS = [
  'back to the assistant',
  'back to assistant',
  'assistant takes over',
  'assistant take over',
  'back to the bot',
  'back to bot',
  '/assistant',
  '/bot',
] as const;

export interface Handback {
  /** True when the school asked for the assistant to resume. */
  handBack: boolean;
  /** What the family should actually receive — the reply with the command taken out. */
  message: string;
}

/**
 * The punctuation that joins a command to a sentence, and nothing else.
 *
 * A full stop is deliberately absent: "The PTA meets Friday at 3pm. /bot" must send the sentence
 * with its own full stop intact. Stripping it because it happened to sit next to the command is
 * the software editing what a school wrote.
 */
const JOINER_BEFORE = /[\s,;:—–-]+$/;
const JOINER_AFTER = /^[\s.,;:—–-]+/;

export function parseHandback(body: string): Handback {
  const raw = (body ?? '').trim();
  const lower = raw.toLowerCase();

  for (const command of HANDBACK_COMMANDS) {
    // Only at an edge. In the middle of a sentence it is somebody talking *about* the assistant,
    // and that must never be mistaken for an instruction to it.
    const atStart = lower.startsWith(command);
    const atEnd = lower.endsWith(command);
    if (!atStart && !atEnd) continue;

    /**
     * A word-shaped command needs a boundary; a slash command does not.
     *
     * Without this, "assistant take over from here" would match "assistant take over" at the
     * start and silently eat the rest of the sentence. `/bot` cannot run into a following word
     * the same way, and requiring a boundary after it would break the commonest form of all —
     * a reply that is nothing but the command.
     */
    if (!command.startsWith('/')) {
      const boundary = atStart ? raw[command.length] : raw[raw.length - command.length - 1];
      if (boundary && !/[\s.,;:!?—–-]/.test(boundary)) continue;
    }

    const rest = atStart ? raw.slice(command.length) : raw.slice(0, raw.length - command.length);
    const message = atStart ? rest.replace(JOINER_AFTER, '') : rest.replace(JOINER_BEFORE, '');
    return { handBack: true, message: message.trim() };
  }

  return { handBack: false, message: raw };
}
