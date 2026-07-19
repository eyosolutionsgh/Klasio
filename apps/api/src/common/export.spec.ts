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
    const body = csv.replace(/^\uFEFF/, '');
    const [header, r1, r2] = body.split('\r\n');
    expect(header).toBe('Name,Note');
    expect(r1).toBe('"Mensah, Ama","says ""hi"""');
    expect(r2).toBe('Boateng,"line\nbreak"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv(['A', 'B'], [[null, undefined]])
      .toString('utf8')
      .replace(/^\uFEFF/, '');
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

describe('formula injection', () => {
  const cells = (csv: Buffer) => csv.toString('utf8').replace('﻿', '').split('\r\n');

  it('neutralises a name that Excel would execute', () => {
    // Reachable from the PUBLIC admissions form: a parent supplies the child's name, the office
    // enrols them, and the bursar opens the student export in Excel.
    const csv = cells(toCsv(['Name'], [["=cmd|'/c calc'!A1"]]));
    expect(csv[1].startsWith("'=") || csv[1].startsWith(`"'=`)).toBe(true);
    expect(csv[1]).not.toMatch(/^=/);
  });

  it('covers every character a spreadsheet treats as a formula start', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const csv = cells(toCsv(['V'], [[`${lead}danger`]]));
      expect(csv[1], lead).not.toMatch(/^[=+\-@\t\r]/);
    }
  });

  it('leaves ordinary Ghanaian names untouched', () => {
    const csv = cells(toCsv(['Name'], [['Kwabena Frimpong'], ["N'Dri Ama"]]));
    expect(csv[1]).toBe('Kwabena Frimpong');
    expect(csv[2]).toBe("N'Dri Ama");
  });

  it('still quotes commas and quotes correctly after prefixing', () => {
    const csv = cells(toCsv(['V'], [['=a,b']]));
    expect(csv[1]).toBe(`"'=a,b"`);
  });

  it('leaves a negative number alone so money exports still sum', () => {
    // A number cannot carry a formula, and prefixing it would turn every negative amount in a
    // ledger export into text — breaking the arithmetic the bursar opened the file to do.
    expect(cells(toCsv(['V'], [[-500]]))[1]).toBe('-500');
  });

  it('still guards a negative-looking string', () => {
    expect(cells(toCsv(['V'], [['-500+cmd']]))[1]).toBe("'-500+cmd");
  });
});
