import { describe, expect, it } from 'vitest';
import { deriveLabels } from './action-labels';

describe('deriveLabels', () => {
  it('conjugates a known verb through the whole cycle', () => {
    expect(deriveLabels('Save')).toEqual({
      pending: 'Saving…',
      done: 'Saved!',
      failed: "Couldn't save",
    });
  });

  it('reads only the first word, so "Save" and "Save changes" agree', () => {
    expect(deriveLabels('Save changes')).toEqual(deriveLabels('Save'));
  });

  it('is case-insensitive on the verb', () => {
    expect(deriveLabels('SEND CODE').done).toBe('Sent!');
    expect(deriveLabels('send code').done).toBe('Sent!');
  });

  it('falls back to neutral wording rather than inventing a past tense', () => {
    expect(deriveLabels('Enrol pupil')).toEqual({
      pending: 'Working…',
      done: 'Done!',
      failed: "Didn't work",
    });
  });

  it('does not fall over on an empty or whitespace label', () => {
    expect(deriveLabels('').pending).toBe('Working…');
    expect(deriveLabels('   ').pending).toBe('Working…');
  });

  it('tolerates leading whitespace before a known verb', () => {
    expect(deriveLabels('  Delete record').done).toBe('Deleted!');
  });
});
