import { describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATES, fillTemplate, listTemplates, renderMessage } from './templates';

const dbWith = (rows: { kind: string; body: string }[]) => ({
  messageTemplate: {
    findUnique: async ({
      where,
    }: {
      where: { schoolId_kind: { schoolId: string; kind: string } };
    }) => rows.find((r) => r.kind === where.schoolId_kind.kind) ?? null,
    findMany: async () => rows,
  },
});

describe('message templates', () => {
  it('ships a default for every kind, and every default uses only its declared placeholders', () => {
    for (const [kind, spec] of Object.entries(MESSAGE_TEMPLATES)) {
      expect(spec.default.trim(), kind).not.toBe('');
      const used = [...spec.default.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const p of used) expect(spec.placeholders, `${kind} uses {${p}}`).toContain(p);
    }
  });

  it('substitutes placeholders and leaves unknown ones alone rather than blanking them', () => {
    expect(fillTemplate('Hi {name}, {unknown} stays', { name: 'Ama' })).toBe(
      'Hi Ama, {unknown} stays',
    );
  });

  it('renders the school’s own wording when one is saved', async () => {
    const db = dbWith([{ kind: 'PICKUP_RELEASED', body: '{student} left with {collector}.' }]);
    const out = await renderMessage(db, 's1', 'PICKUP_RELEASED', {
      student: 'Ama Mensah',
      collector: 'Kofi',
      school: 'Brighton',
      time: '15:42',
    });
    expect(out).toBe('Ama Mensah left with Kofi.');
  });

  it('falls back to the shipped default when nothing is saved', async () => {
    const out = await renderMessage(dbWith([]), 's1', 'ABSENCE_ALERT', {
      school: 'Brighton',
      student: 'Ama Mensah',
      date: '2026-07-20',
    });
    expect(out).toContain('Brighton');
    expect(out).toContain('Ama Mensah');
    expect(out).toContain('2026-07-20');
  });

  it('lists every kind, marking which the school has customised', async () => {
    const db = dbWith([{ kind: 'RESULTS_READY', body: 'Custom.' }]);
    const list = await listTemplates(db, 's1');
    expect(list.map((t) => t.kind).sort()).toEqual(Object.keys(MESSAGE_TEMPLATES).sort());
    const results = list.find((t) => t.kind === 'RESULTS_READY')!;
    expect(results.customised).toBe(true);
    expect(results.body).toBe('Custom.');
    expect(list.find((t) => t.kind === 'ABSENCE_ALERT')!.customised).toBe(false);
  });
});
