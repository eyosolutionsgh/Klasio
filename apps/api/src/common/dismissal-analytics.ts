/**
 * Dismissal analytics (FEATURES.md §9): how long families wait in the car line, and each
 * collector's history. Pure functions over rows the pickup service fetches, so the arithmetic
 * is testable without a database.
 */

export interface WaitSample {
  announcedAt: Date;
  /** When the entry finished — null for rows still open, which contribute nothing. */
  doneAt: Date | null;
}

export interface WaitStats {
  count: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  longestMinutes: number | null;
}

const MINUTE = 60_000;

/** Wait-time statistics over finished car line entries. Unfinished rows are not waits yet. */
export function waitStats(samples: WaitSample[]): WaitStats {
  const waits = samples
    .filter((s): s is WaitSample & { doneAt: Date } => !!s.doneAt)
    .map((s) => (s.doneAt.getTime() - s.announcedAt.getTime()) / MINUTE)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  if (waits.length === 0) {
    return { count: 0, averageMinutes: null, medianMinutes: null, longestMinutes: null };
  }
  const sum = waits.reduce((a, b) => a + b, 0);
  const mid = Math.floor(waits.length / 2);
  const median = waits.length % 2 === 1 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
  return {
    count: waits.length,
    averageMinutes: round1(sum / waits.length),
    medianMinutes: round1(median),
    longestMinutes: round1(waits[waits.length - 1]),
  };
}

export interface ReleaseRowLike {
  collectedBy: string;
  collectorKind: string;
  collectorId: string | null;
  overrideReason: string | null;
  releasedAt: Date;
}

export interface CollectorHistory {
  key: string;
  name: string;
  kind: string;
  pickups: number;
  overrides: number;
  lastAt: Date;
}

/**
 * Per-collector history from the release log. Grouped by collector id where one was recorded,
 * falling back to the captured name — a manual release of a person never put on file still
 * belongs in the history under the name staff wrote down.
 */
export function collectorHistory(rows: ReleaseRowLike[]): CollectorHistory[] {
  const byKey = new Map<string, CollectorHistory>();
  for (const r of rows) {
    const key = r.collectorId ? `${r.collectorKind}:${r.collectorId}` : `NAME:${r.collectedBy}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.pickups += 1;
      if (r.overrideReason) existing.overrides += 1;
      if (r.releasedAt > existing.lastAt) {
        existing.lastAt = r.releasedAt;
        existing.name = r.collectedBy;
      }
    } else {
      byKey.set(key, {
        key,
        name: r.collectedBy,
        kind: r.collectorKind,
        pickups: 1,
        overrides: r.overrideReason ? 1 : 0,
        lastAt: r.releasedAt,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.pickups - a.pickups || a.name.localeCompare(b.name));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
