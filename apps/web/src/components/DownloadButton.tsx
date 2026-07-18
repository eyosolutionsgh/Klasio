'use client';

import { useState } from 'react';

/**
 * Downloads a binary file from an API path through the session-aware proxy.
 * `path` is an API path like `/assessment/reports/<id>/<term>/pdf`.
 */
export default function DownloadButton({
  path,
  filename,
  label,
  tip,
  variant = 'solid',
}: {
  path: string;
  filename: string;
  label: string;
  tip?: string;
  variant?: 'solid' | 'ghost';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy${path}`);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  const cls =
    variant === 'solid'
      ? 'rounded-lg bg-forest text-paper hover:bg-forest-deep'
      : 'rounded-lg border border-mist text-forest hover:bg-forest-mist';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={download}
        disabled={busy}
        data-tip={tip}
        className={`tip text-sm font-medium px-4 py-2 transition disabled:opacity-50 ${cls}`}
      >
        {busy ? 'Preparing…' : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
