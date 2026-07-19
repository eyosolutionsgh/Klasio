'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { DownloadIcon } from '@/components/icons';

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
  const [error, setError] = useState<string | null>(null);

  const download = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy${path}`);
    if (!res.ok) {
      // The button can only say "Couldn't download"; the status is what tells a bursar whether
      // the report simply is not published yet or their session has gone.
      setError(`Download failed (${res.status})`);
      throw new Error('download rejected');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        onClick={download.run}
        state={download.state}
        variant={variant === 'solid' ? 'primary' : 'secondary'}
        icon={<DownloadIcon />}
        data-tip={tip}
        className="tip"
        // "Download" is not one of the conjugated verbs, and callers pass their own label
        // ("Print sheet", "PDF"), so the outcome wording is stated rather than derived.
        pendingLabel="Preparing…"
        doneLabel="Downloaded!"
        failedLabel="Couldn't download"
      >
        {label}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
