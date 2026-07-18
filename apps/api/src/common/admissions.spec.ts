import { describe, expect, it } from 'vitest';
import { allowedStages, stageMoveError, STAGE_ORDER } from './admissions';

describe('stageMoveError', () => {
  it('lets an applicant move one step forward', () => {
    expect(stageMoveError('APPLIED', 'ASSESSED')).toBeNull();
    expect(stageMoveError('ASSESSED', 'OFFERED')).toBeNull();
    expect(stageMoveError('OFFERED', 'ACCEPTED')).toBeNull();
  });

  it('refuses to skip a step, so the pipeline stays an honest history', () => {
    expect(stageMoveError('ENQUIRY', 'OFFERED')).toBe('Move through APPLIED first');
  });

  it('allows moving back to correct a miskeyed stage', () => {
    expect(stageMoveError('OFFERED', 'APPLIED')).toBeNull();
  });

  it('declines from anywhere in the pipeline', () => {
    for (const stage of STAGE_ORDER.filter((s) => s !== 'ENROLLED')) {
      expect(stageMoveError(stage, 'DECLINED')).toBeNull();
    }
  });

  it('reopens a declined application', () => {
    expect(stageMoveError('DECLINED', 'ASSESSED')).toBeNull();
  });

  it('never lets a stage move reach ENROLLED — only conversion may, so the cap holds', () => {
    expect(stageMoveError('ACCEPTED', 'ENROLLED')).toMatch(/Convert/);
    expect(stageMoveError('DECLINED', 'ENROLLED')).toMatch(/Convert/);
  });

  it('closes the pipeline once the applicant is a student', () => {
    expect(stageMoveError('ENROLLED', 'DECLINED')).toMatch(/already a student/);
    expect(stageMoveError('ENROLLED', 'OFFERED')).toMatch(/already a student/);
  });

  it('rejects a no-op move', () => {
    expect(stageMoveError('APPLIED', 'APPLIED')).toMatch(/already at that stage/);
  });
});

describe('allowedStages', () => {
  it('offers only moves the API will accept', () => {
    expect(allowedStages('ASSESSED')).toEqual(['ENQUIRY', 'APPLIED', 'OFFERED', 'DECLINED']);
  });

  it('offers nothing once enrolled', () => {
    expect(allowedStages('ENROLLED')).toEqual([]);
  });
});
