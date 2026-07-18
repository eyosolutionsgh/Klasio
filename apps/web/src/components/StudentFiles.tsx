'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Doc {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const KINDS = ['BIRTH_CERTIFICATE', 'IMMUNISATION', 'PREVIOUS_REPORT', 'OTHER'];
const label = (k: string) => k.toLowerCase().replace(/_/g, ' ');
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default function StudentFiles({
  studentId,
  hasPhoto,
}: {
  studentId: string;
  hasPhoto: boolean;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kind, setKind] = useState('OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/students/${studentId}/documents`);
    if (res.ok) setDocs(await res.json());
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(path: string, file: File, extra?: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
      const res = await fetch(`/api/proxy/students/${studentId}/${path}`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? 'Upload failed');
      }
      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id: string) {
    const res = await fetch(`/api/proxy/documents/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <section className="card p-6 no-print">
      <h2 className="font-display text-xl">Photo &amp; documents</h2>

      <div className="flex items-center gap-4 mt-4">
        {hasPhoto ? (
          // Plain <img>: the photo streams from an authenticated proxy route, which the
          // next/image optimiser cannot fetch on the server.
          <img
            src={`/api/proxy/students/${studentId}/photo`}
            alt="Student"
            className="w-16 h-16 rounded-full object-cover border border-mist"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-parchment border border-mist flex items-center justify-center text-[11px] text-oat text-center">
            No photo
          </div>
        )}
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Student photo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload('photo', f);
            }}
            className="text-sm"
          />
          <span className="block text-[11px] text-oat mt-1">
            Appears on receipts. JPEG, PNG or WebP, up to 8MB.
          </span>
        </label>
      </div>

      <div className="mt-6">
        <p className="text-[13px] font-medium">Documents</p>
        <ul className="mt-2 space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span className="min-w-0">
                <a
                  href={`/api/proxy/documents/${d.id}`}
                  className="text-brand hover:underline underline-offset-2"
                >
                  {d.filename}
                </a>
                <span className="text-oat text-xs ml-2">
                  {label(d.kind)} · {kb(d.size)}
                </span>
              </span>
              <button
                onClick={() => removeDoc(d.id)}
                className="text-[12px] text-clay hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
          {docs.length === 0 && <li className="text-xs text-oat">No documents on file.</li>}
        </ul>

        <div className="flex items-center gap-2 mt-3">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload('documents', f, { kind });
            }}
            className="text-sm"
          />
        </div>
      </div>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </section>
  );
}
