'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';

interface ReportRow {
  studentId: string;
  name: string;
  admissionNo: string;
  overallTotal: number;
  classPosition: number | null;
  classSize: number | null;
  publishedAt: string | null;
}
interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}
interface Broadsheet {
  className: string;
  termName?: string;
  earlyYears: boolean;
  subjects: { id: string; name: string; code: string }[];
  rows: {
    admissionNo: string;
    name: string;
    cells: { total: number | null }[];
    overallTotal: number;
    position: number | null;
  }[];
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export default function ReportsPage() {
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [classId, setClassId] = useState('');
  const [termId, setTermId] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [broadsheet, setBroadsheet] = useState<Broadsheet | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/school/structure').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]).then(([s, me]) => {
      const withStudents = s.classes.filter((c: ClassOpt) => c.studentCount > 0);
      setClasses(withStudents);
      if (withStudents[0]) setClassId(withStudents[0].id);
      if (me.currentTerm) setTermId(me.currentTerm.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!classId || !termId) return;
    const res = await fetch(`/api/proxy/assessment/reports?classId=${classId}&termId=${termId}`);
    setRows(await res.json());
  }, [classId, termId]);

  useEffect(() => {
    load();
    setBroadsheet(null);
  }, [load]);

  async function toggleBroadsheet() {
    if (broadsheet) {
      setBroadsheet(null);
      return;
    }
    const res = await fetch(`/api/proxy/assessment/broadsheet?classId=${classId}&termId=${termId}`);
    if (res.ok) setBroadsheet(await res.json());
  }

  /** Publishing is what makes a report visible to guardians — and freezes its remarks. */
  async function setPublished(published: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/proxy/assessment/reports/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, termId, published }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage(
        published
          ? `Published ${body.count} report${body.count === 1 ? '' : 's'}.`
          : `Unpublished ${body.count} report${body.count === 1 ? '' : 's'} — remarks are editable again.`,
      );
      load();
    } else {
      setMessage(body.message ?? 'Could not change publication state.');
    }
  }

  async function generate() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/proxy/assessment/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, termId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage(
        `Generated ${body.generated} report${body.generated === 1 ? '' : 's'} for this class.`,
      );
      load();
    } else {
      setMessage(body.message ?? 'Could not generate reports.');
    }
  }

  const allPublished = rows.length > 0 && rows.every((r) => r.publishedAt);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Terminal reports</h1>
        <p className="text-sm text-oat mt-1.5">
          Computes SBA (30%) + exam (70%), GES grades, subject and class positions from saved
          scores.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rise rise-2">
        <Combobox
          label="Class"
          className="w-full sm:w-56"
          allowClear={false}
          placeholder="Search classes…"
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
          value={classId}
          onChange={setClassId}
        />
        <button
          onClick={generate}
          disabled={busy || !classId}
          data-tip="Recomputes every report in this class from the latest scores"
          className="tip rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
        >
          {busy ? 'Computing…' : 'Generate reports'}
        </button>
        <button
          onClick={toggleBroadsheet}
          disabled={!classId || !termId}
          className="rounded-lg border border-mist text-brand text-sm font-medium px-5 py-2 hover:bg-brand-mist transition disabled:opacity-50"
        >
          {broadsheet ? 'Hide broadsheet' : 'View broadsheet'}
        </button>
        {rows.length > 0 &&
          (allPublished ? (
            <button
              onClick={() => setPublished(false)}
              disabled={busy}
              data-tip="Retract from guardians and re-open remarks for editing"
              className="tip rounded-lg border border-mist text-clay text-sm font-medium px-5 py-2 hover:bg-clay/5 transition disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => setPublished(true)}
              disabled={busy}
              data-tip="Release these reports to guardians"
              className="tip rounded-lg bg-gold-soft text-ink text-sm font-medium px-5 py-2 hover:brightness-95 transition disabled:opacity-50"
            >
              Publish reports
            </button>
          ))}
        {classId && termId && (
          <span className="flex items-center gap-1 text-[13px]">
            <span className="text-oat">Export:</span>
            {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
              <a
                key={f}
                href={`/api/proxy/assessment/broadsheet/export?classId=${classId}&termId=${termId}&format=${f}`}
                className="rounded-md border border-mist px-2.5 py-1 text-brand hover:bg-brand-mist transition uppercase"
              >
                {f}
              </a>
            ))}
          </span>
        )}
        {message && <p className="text-sm text-oat">{message}</p>}
      </div>

      {broadsheet && (
        <div className="card mt-6 overflow-x-auto rise rise-2">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider bg-parchment/60">
                <th className="border border-mist px-2 py-2 text-left font-medium">Adm.</th>
                <th className="border border-mist px-2 py-2 text-left font-medium">Name</th>
                {broadsheet.subjects.map((s) => (
                  <th
                    key={s.id}
                    className="border border-mist px-2 py-2 font-medium"
                    title={s.name}
                  >
                    {s.code}
                  </th>
                ))}
                {!broadsheet.earlyYears && (
                  <>
                    <th className="border border-mist px-2 py-2 font-medium">Total</th>
                    <th className="border border-mist px-2 py-2 font-medium">Pos.</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {broadsheet.rows.map((r) => (
                <tr key={r.admissionNo}>
                  <td className="border border-mist px-2 py-1.5 tabular text-oat">
                    {r.admissionNo}
                  </td>
                  <td className="border border-mist px-2 py-1.5 font-medium whitespace-nowrap">
                    {r.name}
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="border border-mist px-2 py-1.5 text-center tabular">
                      {c.total == null
                        ? '—'
                        : broadsheet.earlyYears
                          ? Math.round(c.total)
                          : c.total.toFixed(0)}
                    </td>
                  ))}
                  {!broadsheet.earlyYears && (
                    <>
                      <td className="border border-mist px-2 py-1.5 text-center tabular font-medium">
                        {r.overallTotal.toFixed(0)}
                      </td>
                      <td className="border border-mist px-2 py-1.5 text-center tabular">
                        {r.position ?? '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card mt-6 overflow-x-auto rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Position</th>
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium text-right">Overall total</th>
              <th className="px-5 py-3 font-medium text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.studentId}
                className="border-b border-mist/60 last:border-0 hover:bg-parchment/40 transition"
              >
                <td className="px-5 py-3">
                  <span
                    className={`font-display text-lg tabular ${r.classPosition === 1 ? 'text-gold' : 'text-ink'}`}
                  >
                    {r.classPosition ? ordinal(r.classPosition) : '—'}
                  </span>
                  <span className="text-oat text-xs"> / {r.classSize}</span>
                </td>
                <td className="px-5 py-3">
                  <p className="font-medium">
                    {r.name}
                    {r.publishedAt && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider bg-brand-mist text-brand rounded-full px-2 py-0.5">
                        Published
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-oat tabular">{r.admissionNo}</p>
                </td>
                <td className="px-5 py-3 text-right tabular font-medium">
                  {r.overallTotal.toFixed(1)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/reports/${r.studentId}/${termId}`}
                    className="text-brand font-medium text-[13px] hover:underline underline-offset-2"
                  >
                    View terminal report →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No reports yet for this class — enter scores, then press “Generate reports”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
