/**
 * Grading-scheme band validation.
 *
 * A scheme maps a 0–100 total to a grade/band label. If the bands leave a gap, a student can
 * land on a score with no grade at all; if they overlap, the grade depends on array order,
 * which is invisible to the person configuring it. Both are silent correctness bugs on the
 * document that goes home to guardians, so schemes are validated before they are stored.
 */
export interface Band {
  min: number;
  max: number;
  grade: string;
  remark: string;
}

export function validateBands(bands: Band[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(bands) || bands.length === 0) {
    return { ok: false, error: 'A grading scheme needs at least one band' };
  }
  for (const b of bands) {
    if (
      typeof b.min !== 'number' ||
      typeof b.max !== 'number' ||
      !b.grade?.trim() ||
      Number.isNaN(b.min) ||
      Number.isNaN(b.max)
    ) {
      return { ok: false, error: 'Every band needs a numeric min, max and a grade label' };
    }
    if (b.min > b.max) {
      return { ok: false, error: `Band "${b.grade}" has min ${b.min} above max ${b.max}` };
    }
    if (b.min < 0 || b.max > 100) {
      return { ok: false, error: `Band "${b.grade}" falls outside 0–100` };
    }
  }

  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 0) {
    return { ok: false, error: `Bands must start at 0 (lowest starts at ${sorted[0].min})` };
  }
  if (sorted[sorted.length - 1].max !== 100) {
    return {
      ok: false,
      error: `Bands must reach 100 (highest ends at ${sorted[sorted.length - 1].max})`,
    };
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.min <= prev.max) {
      return { ok: false, error: `Bands "${prev.grade}" and "${cur.grade}" overlap` };
    }
    if (cur.min > prev.max + 1) {
      return {
        ok: false,
        error: `Scores between ${prev.max} and ${cur.min} have no grade ("${prev.grade}" → "${cur.grade}")`,
      };
    }
  }
  return { ok: true };
}
