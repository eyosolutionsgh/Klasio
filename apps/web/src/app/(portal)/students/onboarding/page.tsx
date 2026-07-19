'use client';

import Link from 'next/link';
import { useState } from 'react';
import FileField from '@/components/FileField';

type Kind = 'students' | 'fees' | 'balances';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const KINDS: { key: Kind; label: string; blurb: string }[] = [
  { key: 'students', label: 'Students', blurb: 'Bio-data, class and primary guardian.' },
  { key: 'fees', label: 'Fee structure', blurb: 'Fee items for the current term.' },
  { key: 'balances', label: 'Opening balances', blurb: 'Arrears carried in from before.' },
];

export default function OnboardingPage() {
  const [kind, setKind] = useState<Kind>('students');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/proxy/onboarding/import/${kind}`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Import failed');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link href="/students" className="text-[13px] text-oat hover:text-brand transition">
        ← Back to students
      </Link>
      <div className="rise rise-1 mt-4">
        <h1 className="font-display text-3xl">Bulk onboarding</h1>
        <p className="text-sm text-oat mt-1.5">
          Download an Excel template, fill it in, and upload to import in bulk.
        </p>
      </div>

      <div className="mt-6 grid sm:grid-cols-3 gap-3 rise rise-2">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => {
              setKind(k.key);
              setResult(null);
              setError(null);
            }}
            className={`card p-4 text-left transition ${kind === k.key ? 'ring-2 ring-brand' : 'hover:border-brand'}`}
          >
            <p className="font-medium">{k.label}</p>
            <p className="text-xs text-oat mt-1">{k.blurb}</p>
          </button>
        ))}
      </div>

      <div className="card p-6 mt-6 rise rise-3 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-oat">Step 1 —</span>
          <a
            href={`/api/proxy/onboarding/templates/${kind}`}
            className="rounded-lg border border-mist text-brand text-sm font-medium px-4 py-2 hover:bg-brand-mist transition"
          >
            Download {kind} template
          </a>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-sm text-oat mt-3">Step 2 —</span>
          <div className="flex-1 min-w-56">
            <FileField
              id="onboarding-file"
              accept=".xlsx"
              value={file}
              onChange={setFile}
              disabled={busy}
              hint="The filled-in template, as an .xlsx workbook."
            />
          </div>
          <button
            onClick={upload}
            disabled={busy || !file}
            className="mt-1 rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2.5 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Upload & import'}
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <div className="rounded-lg bg-parchment/60 p-4">
            <p className="text-sm font-medium text-brand">
              Imported {result.imported} · skipped {result.skipped} · {result.errors.length} error
              {result.errors.length === 1 ? '' : 's'}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 text-xs text-danger space-y-0.5 max-h-48 overflow-y-auto">
                {result.errors.map((er, i) => (
                  <li key={i}>
                    Row {er.row}: {er.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
