/**
 * Deciding whether a replayed offline write is still the truth.
 *
 * The offline queue replays a write when the network returns, which can be days after a teacher
 * made it. Until now the server applied it unconditionally, so arrival order decided the outcome
 * rather than the order things actually happened:
 *
 *   09:00  a teacher, offline, marks Kofi PRESENT
 *   10:00  the office corrects Kofi to ABSENT — he went home ill
 *   11:00  the teacher's device reconnects and replays, and Kofi is PRESENT again
 *
 * Nobody is told. The office believes it corrected the register, the report card and the statutory
 * return carry the wrong figure, and the audit trail shows the teacher as the last person to touch
 * it. Marks are worse: that page sends the whole class's column at once, so one stale replay
 * reverts every correction made to a subject since the device went offline.
 *
 * So a write carries the moment it was *made*, and loses to anything the server has recorded
 * since. Last-write-wins, on the clock the user acted against rather than the clock the packet
 * arrived on.
 *
 * The client clock is not trustworthy in general, but it is the only record of when the teacher
 * actually marked the register, and the failure it introduces is bounded: a device with a badly
 * wrong clock either loses its own replay (skew backwards) or wins one it should not (skew
 * forwards) — for its own class, on its own register. That is a far smaller wrong than silently
 * reverting every correction, which is the behaviour it replaces.
 */

/**
 * Is this write older than what the server already holds?
 *
 * Absent `recordedAt` is never stale: an online write is happening now, and a client too old to
 * stamp its writes must keep working exactly as before rather than being silently dropped.
 * Equality is not stale either — replaying the identical write is harmless, and treating the same
 * instant as a loss would make a re-sync depend on millisecond luck.
 */
export function isStaleReplay(
  recordedAt: Date | null | undefined,
  lastTouched: Date | null | undefined,
): boolean {
  if (!recordedAt || !lastTouched) return false;
  return lastTouched.getTime() > recordedAt.getTime();
}

/** Parse a client-supplied timestamp, refusing anything unusable rather than guessing. */
export function parseRecordedAt(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
