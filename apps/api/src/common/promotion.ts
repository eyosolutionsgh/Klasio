/**
 * End of year: who moves up, who stays, who leaves.
 *
 * Promotion used to be a whole-class `updateMany` — every active child in Basic 5 became a child
 * in Basic 6, together, or the whole class graduated. Real schools do not work that way. A child
 * repeats; a child who has been away all year is held back; the rest move on. With only the bulk
 * action, holding one child back meant promoting the class and then editing that child's record
 * afterwards, which is the kind of two-step nobody remembers to finish.
 *
 * The suggestion below is only a default. Every decision is per child and every one of them is
 * shown before anything is written.
 */

export type PromotionAction = 'PROMOTE' | 'REPEAT' | 'GRADUATE';

export interface ClassLike {
  id: string;
  name: string;
  levelId: string;
  levelOrder: number;
}

/**
 * The class a child in `from` would ordinarily move into: the next level up, preferring a class
 * whose name matches the stream they are already in.
 *
 * Streams are named by convention rather than modelled ("Basic 5 Gold" → "Basic 6 Gold"), so this
 * matches on the trailing word. It is a suggestion; where the guess is wrong the reviewer sees a
 * named class in a dropdown and changes it, which is cheaper than making them pick 40 times.
 */
export function suggestNextClass(from: ClassLike, all: ClassLike[]): ClassLike | null {
  const higher = all.filter((c) => c.levelOrder > from.levelOrder);
  if (higher.length === 0) return null;

  const nextOrder = Math.min(...higher.map((c) => c.levelOrder));
  const candidates = higher.filter((c) => c.levelOrder === nextOrder);
  if (candidates.length === 1) return candidates[0];

  // Several classes in the next level — try to keep the child in the same stream.
  const stream = streamOf(from.name);
  if (stream) {
    const sameStream = candidates.find((c) => streamOf(c.name) === stream);
    if (sameStream) return sameStream;
  }
  // Stable rather than arbitrary, so the same roll suggests the same thing twice running.
  return [...candidates].sort((a, b) => a.name.localeCompare(b.name))[0];
}

/** "Basic 6 Gold" → "gold"; "JHS 2" → null. The stream is a trailing non-numeric word. */
function streamOf(name: string): string | null {
  const last = name.trim().split(/\s+/).pop() ?? '';
  if (!last || /\d/.test(last)) return null;
  return last.toLowerCase();
}

/**
 * Is the class the school's last — the one whose children leave rather than move up?
 *
 * Used only to default the suggestion to GRADUATE. Graduating still has to be confirmed
 * explicitly: it is irreversible, and a default is not consent.
 */
export function isFinalClass(from: ClassLike, all: ClassLike[]): boolean {
  return !all.some((c) => c.levelOrder > from.levelOrder);
}
