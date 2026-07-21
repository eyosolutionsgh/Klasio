'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { fileKind, fileSize } from '@/lib/files';

interface Doc {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const KINDS = ['BIRTH_CERTIFICATE', 'IMMUNISATION', 'PREVIOUS_REPORT', 'OTHER'];
const KIND_LABEL: Record<string, string> = {
  BIRTH_CERTIFICATE: 'Birth certificate',
  IMMUNISATION: 'Immunisation card',
  PREVIOUS_REPORT: 'Previous report',
  OTHER: 'Other',
};

/**
 * Papers attached to one applicant, in a dialog off the pipeline row. Whatever is here follows
 * the child onto their student record at enrolment, so nothing is asked for twice.
 */
export default function ApplicantFiles({
  applicantId,
  applicantName,
}: {
  applicantId: string;
  applicantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [kind, setKind] = useState('OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/admissions/${applicantId}/documents`);
    if (res.ok) setDocs(await res.json());
  }, [applicantId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const res = await fetch(`/api/proxy/admissions/${applicantId}/documents`, {
      method: 'POST',
      body: form,
    });
    setBusy(false);
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'Could not attach that file.');
    }
  }

  async function remove(doc: Doc) {
    if (!confirm(`Remove ${doc.filename}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/proxy/admissions/documents/${doc.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) load();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="self-end min-h-11 inline-flex items-center text-sm text-oat hover:text-brand transition px-2 underline underline-offset-2"
      >
        Files
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Documents for ${applicantName}`}
            className="brand-scope fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              className="card w-full max-w-md p-6"
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            >
              <h2 className="font-display text-2xl">Papers for {applicantName}</h2>
              <p className="text-sm text-oat mt-1.5">
                Anything attached here follows the child onto their student record at enrolment.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <label className="min-h-11 inline-flex items-center rounded-lg border border-brand text-brand text-sm font-medium px-4 cursor-pointer hover:bg-brand hover:text-white transition">
                  {busy ? 'Working…' : 'Attach a file'}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {error && <p className="text-sm text-danger mt-2">{error}</p>}

              <ul className="mt-4 space-y-2">
                {(docs ?? []).map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 border-b border-mist/50 last:border-0 pb-2 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.filename}</p>
                      <p className="text-[11px] text-oat">
                        {KIND_LABEL[d.kind] ?? d.kind} · {fileKind(d.contentType)} ·{' '}
                        {fileSize(d.size)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`/api/proxy/admissions/documents/${d.id}`}
                        className="text-[12px] text-brand hover:underline underline-offset-2"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => remove(d)}
                        disabled={busy}
                        className="text-[12px] text-clay hover:underline underline-offset-2"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {docs && docs.length === 0 && (
                  <li className="text-sm text-oat">Nothing attached yet.</li>
                )}
              </ul>

              <div className="mt-5">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
