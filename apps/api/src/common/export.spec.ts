import { describe, expect, it } from 'vitest';
import { toCsv, toXlsx, parseXlsx, templateXlsx } from './export';

describe('CSV export', () => {
  it('quotes cells containing commas, quotes and newlines', () => {
    const csv = toCsv(
      ['Name', 'Note'],
      [
        ['Mensah, Ama', 'says "hi"'],
        ['Boateng', 'line\nbreak'],
      ],
    ).toString('utf8');
    // Strip the UTF-8 BOM.
    const body = csv.replace(/^﻿/, '');
    const [header, r1, r2] = body.split('\r\n');
    expect(header).toBe('Name,Note');
    expect(r1).toBe('"Mensah, Ama","says ""hi"""');
    expect(r2).toBe('Boateng,"line\nbreak"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv(['A', 'B'], [[null, undefined]])
      .toString('utf8')
      .replace(/^﻿/, '');
    expect(csv.split('\r\n')[1]).toBe(',');
  });
});

describe('xlsx round-trip', () => {
  it('writes rows and parses them back keyed by header', async () => {
    const buf = await toXlsx(
      'People',
      ['First Name', 'Age'],
      [
        ['Ama', 30],
        ['Yaw', 12],
      ],
    );
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // xlsx is a zip
    const rows = await parseXlsx(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]['First Name']).toBe('Ama');
    expect(rows[0]['Age']).toBe('30');
    expect(rows[1]['First Name']).toBe('Yaw');
  });

  it('skips fully-empty rows on parse', async () => {
    const buf = await toXlsx('S', ['A'], [['x'], [null], ['y']]);
    const rows = await parseXlsx(buf);
    expect(rows.map((r) => r['A'])).toEqual(['x', 'y']);
  });
});

describe('onboarding template', () => {
  it('includes headers and sample rows', async () => {
    const buf = await templateXlsx({
      sheetName: 'Students',
      headers: ['First Name', 'Last Name'],
      sample: [['Ama', 'Mensah']],
    });
    const rows = await parseXlsx(buf);
    expect(rows[0]['First Name']).toBe('Ama');
    expect(rows[0]['Last Name']).toBe('Mensah');
  });
});
