import { describe, expect, it } from 'vitest';
import { collectorHistory, waitStats } from './dismissal-analytics';

const at = (min: number) => new Date(2026, 6, 20, 15, min);

describe('waitStats', () => {
  it('averages, medians and maxes over finished waits only', () => {
    const stats = waitStats([
      { announcedAt: at(0), doneAt: at(4) }, // 4 min
      { announcedAt: at(0), doneAt: at(10) }, // 10 min
      { announcedAt: at(0), doneAt: at(7) }, // 7 min
      { announcedAt: at(30), doneAt: null }, // still waiting — not a wait yet
    ]);
    expect(stats.count).toBe(3);
    expect(stats.averageMinutes).toBe(7);
    expect(stats.medianMinutes).toBe(7);
    expect(stats.longestMinutes).toBe(10);
  });

  it('is honest about an empty day', () => {
    expect(waitStats([])).toEqual({
      count: 0,
      averageMinutes: null,
      medianMinutes: null,
      longestMinutes: null,
    });
  });

  it('takes the even-count median between the middle pair', () => {
    const stats = waitStats([
      { announcedAt: at(0), doneAt: at(2) },
      { announcedAt: at(0), doneAt: at(4) },
      { announcedAt: at(0), doneAt: at(6) },
      { announcedAt: at(0), doneAt: at(20) },
    ]);
    expect(stats.medianMinutes).toBe(5);
  });

  it('drops a clock-skewed negative wait rather than corrupting the average', () => {
    const stats = waitStats([{ announcedAt: at(10), doneAt: at(5) }]);
    expect(stats.count).toBe(0);
  });
});

describe('collectorHistory', () => {
  const row = (over: Partial<Parameters<typeof collectorHistory>[0][number]> = {}) => ({
    collectedBy: 'Kofi Mensah',
    collectorKind: 'GUARDIAN',
    collectorId: 'g1',
    overrideReason: null,
    releasedAt: at(0),
    ...over,
  });

  it('groups by collector and counts pickups and overrides', () => {
    const rows = [
      row(),
      row({ releasedAt: at(30), overrideReason: 'aunt collecting, mother phoned' }),
      row({ collectorId: 'g2', collectedBy: 'Ama Serwaa' }),
    ];
    const history = collectorHistory(rows);
    expect(history).toHaveLength(2);
    const kofi = history.find((h) => h.key === 'GUARDIAN:g1')!;
    expect(kofi.pickups).toBe(2);
    expect(kofi.overrides).toBe(1);
    expect(kofi.lastAt).toEqual(at(30));
    expect(history[0].pickups).toBeGreaterThanOrEqual(history[1].pickups);
  });

  it('keeps a manual release with no id under the name staff wrote down', () => {
    const history = collectorHistory([
      row({ collectorId: null, collectedBy: 'Neighbour Yaw', collectorKind: 'DELEGATE' }),
    ]);
    expect(history[0].key).toBe('NAME:Neighbour Yaw');
    expect(history[0].pickups).toBe(1);
  });
});
