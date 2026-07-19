'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/** BIRTH_CERTIFICATE → "Birth certificate". The old formatter only lowercased, so the type
 *  read as "other" — which looks like unfinished work rather than a considered default. */
const label = (k: string) => k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ');

const size = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Mirrors the API (common/storage.ts). Checking here too means a too-large file is refused
// instantly with a readable message, rather than after pushing 20MB up a Ghanaian mobile link
// to be told no.
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf'];

function reject(file: File, allowed: string[]): string | null {
  if (!allowed.includes(file.type)) {
    return `${file.name} is not a supported file type. Use ${allowed.includes('application/pdf') ? 'PDF, JPEG, PNG or WebP' : 'JPEG, PNG or WebP'}.`;
  }
  if (file.size > MAX_BYTES) return `${file.name} is ${size(file.size)}. The limit is 8MB.`;
  return null;
}

function FileIcon({ contentType }: { contentType: string }) {
  const pdf = contentType === 'application/pdf';
  return (
    <span
      aria-hidden
      className={`shrink-0 w-9 h-9 rounded-lg grid place-items-center ${
        pdf ? 'bg-clay/10 text-clay' : 'bg-brand-mist text-brand'
      }`}
    >
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-current">
        {pdf ? (
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h1.5a1.5 1.5 0 010 3H9v2H8v-5zm1 1v1h.5a.5.5 0 000-1H9zm3-1h1.6c.8 0 1.4.7 1.4 1.6v1.8c0 .9-.6 1.6-1.4 1.6H12v-5zm1 1v3h.5c.3 0 .5-.2.5-.6v-1.8c0-.4-.2-.6-.5-.6H13zm3-1h2.5v1H17v1h1.3v1H17v2h-1v-5z" />
        ) : (
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5V5h14v14zM8.5 9.5a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zM6 17l3.5-4.5 2.5 3 3.5-4.5L19 17H6z" />
        )}
      </svg>
    </span>
  );
}

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
  const [busy, setBusy] = useState<null | 'photo' | 'document'>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  // dragenter/dragleave fire for every child element the pointer crosses, so a plain boolean
  // flickers the whole time you move inside the zone. Counting enters against leaves doesn't.
  const depth = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/students/${studentId}/documents`);
    if (res.ok) setDocs(await res.json());
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(path: 'photo' | 'documents', file: File, extra?: Record<string, string>) {
    const bad = reject(file, path === 'photo' ? IMAGE_TYPES : DOC_TYPES);
    if (bad) return setError(bad);

    setBusy(path === 'photo' ? 'photo' : 'document');
    setPending(file.name);
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
      setBusy(null);
      setPending(null);
    }
  }

  async function removeDoc(id: string) {
    setConfirming(null);
    const res = await fetch(`/api/proxy/documents/${id}`, { method: 'DELETE' });
    if (res.ok) load();
    else setError('Could not remove that document.');
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload('documents', f, { kind });
  }

  return (
    <section className="card p-6 no-print">
      <h2 className="font-display text-xl">Photo &amp; documents</h2>

      {/* ── Photo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mt-5">
        {hasPhoto ? (
          // Plain <img>: the photo streams from an authenticated proxy route, which the
          // next/image optimiser cannot fetch on the server.
          <img
            src={`/api/proxy/students/${studentId}/photo`}
            alt="Student"
            className="w-16 h-16 rounded-full object-cover border border-mist shrink-0"
          />
        ) : (
          <div
            aria-hidden
            className="w-16 h-16 rounded-full bg-parchment border border-mist grid place-items-center text-oat shrink-0"
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current opacity-60">
              <path d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Student photo</p>
          <p className="text-[12px] text-oat mt-0.5">
            Appears on receipts. JPEG, PNG or WebP, up to 8MB.
          </p>
          {/* The native input stays in the DOM and focusable — it is only visually replaced.
              Hiding it with `display: none` would take it out of the tab order and leave the
              control unreachable by keyboard. */}
          <label className="mt-2 inline-flex items-center gap-2 rounded-lg border border-mist bg-white px-3 py-1.5 text-[13px] font-medium cursor-pointer transition hover:border-brand hover:text-brand focus-within:ring-2 focus-within:ring-brand/30 has-[:disabled]:opacity-60 has-[:disabled]:cursor-not-allowed">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden>
              <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
            </svg>
            {busy === 'photo' ? 'Uploading…' : hasPhoto ? 'Replace photo' : 'Upload photo'}
            <input
              type="file"
              accept={IMAGE_TYPES.join(',')}
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload('photo', f);
                e.target.value = '';
              }}
              className="sr-only"
            />
          </label>
        </div>
      </div>

      {/* ── Documents ─────────────────────────────────────────────────────── */}
      <div className="mt-7 border-t border-mist pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium">Documents</p>
          {docs.length > 0 && (
            <p className="text-[12px] text-oat">
              {docs.length} {docs.length === 1 ? 'file' : 'files'}
            </p>
          )}
        </div>

        {docs.length > 0 && (
          <ul className="mt-3 divide-y divide-mist rounded-xl border border-mist overflow-hidden">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 bg-white/60">
                <FileIcon contentType={d.contentType} />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/proxy/documents/${d.id}`}
                    className="block truncate text-sm font-medium text-ink hover:text-brand hover:underline underline-offset-2"
                  >
                    {d.filename}
                  </a>
                  <p className="text-[12px] text-oat mt-0.5">
                    <span className="inline-block rounded bg-parchment px-1.5 py-px text-[11px] text-ink/70">
                      {label(d.kind)}
                    </span>
                    <span className="ml-2">
                      {size(d.size)} · {when(d.createdAt)}
                    </span>
                  </p>
                </div>
                {/* Two-step, because there is no undo: a stray click on the row that holds a
                    child's birth certificate should not be able to delete it. */}
                {confirming === d.id ? (
                  <span className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => removeDoc(d.id)}
                      className="rounded-md bg-danger px-2 py-1 text-[12px] font-medium text-white hover:opacity-90"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-[12px] text-oat hover:text-ink"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirming(d.id)}
                    aria-label={`Remove ${d.filename}`}
                    className="tip shrink-0 rounded-md p-1.5 text-oat transition hover:bg-clay/10 hover:text-clay"
                    data-tip="Remove this document"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden>
                      <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Stacked, not side by side. This card lives in a narrow column on the student page, and
            a viewport-based `sm:` breakpoint knows nothing about that — it put a full-width select
            beside a dropzone barely wide enough for three wrapped words. */}
        <div className="mt-3 flex flex-col gap-3">
          <label className="text-[12px] text-oat">
            Document type
            <div className="relative mt-1">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full appearance-none rounded-lg border border-mist bg-white pl-3 pr-9 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 fill-current text-oat"
              >
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </div>
          </label>

          <label
            onDragEnter={(e) => {
              e.preventDefault();
              depth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => {
              depth.current -= 1;
              if (depth.current <= 0) setDragging(false);
            }}
            onDrop={onDrop}
            className={`flex items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-5 text-[13px] text-center cursor-pointer transition focus-within:ring-2 focus-within:ring-brand/30 ${
              dragging
                ? 'border-brand bg-brand-mist text-brand'
                : 'border-mist bg-parchment/40 text-oat hover:border-brand hover:bg-brand-mist/40 hover:text-brand'
            } ${busy === 'document' ? 'opacity-70 pointer-events-none' : ''}`}
          >
            {busy === 'document' ? (
              <>
                <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" aria-hidden>
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray="42"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
                </svg>
                <span className="truncate">Uploading {pending}…</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0" aria-hidden>
                  <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
                </svg>
                <span>
                  <span className="font-medium">
                    {dragging ? 'Drop to upload' : 'Drag a file here'}
                  </span>
                  {!dragging && <span className="text-oat"> or click to browse</span>}
                </span>
              </>
            )}
            <input
              type="file"
              accept={DOC_TYPES.join(',')}
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload('documents', f, { kind });
                // Clear it, or picking the same file twice in a row fires no change event.
                e.target.value = '';
              }}
              className="sr-only"
            />
          </label>
        </div>

        {docs.length === 0 && !busy && (
          <p className="mt-2.5 text-[12px] text-oat">
            No documents on file yet — a birth certificate and immunisation record are the usual
            first two.
          </p>
        )}
        <p className="mt-2 text-[11px] text-oat">PDF, JPEG, PNG or WebP · up to 8MB each</p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
