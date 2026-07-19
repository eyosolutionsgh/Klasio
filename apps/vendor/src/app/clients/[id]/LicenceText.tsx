'use client';

import { useState } from 'react';

/**
 * The signed licence, on demand.
 *
 * Behind a click rather than always visible: it is four hundred characters of base64 and would
 * bury the details that are actually readable. Copy is what people want — the school needs it
 * pasted into their portal, and selecting it by hand from a wrapped block is how a character gets
 * lost.
 */
export default function LicenceText({ signed, licenceId }: { signed: string; licenceId: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3">
      <div className="flex gap-3 text-xs">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="text-navy underline underline-offset-2"
        >
          {shown ? 'Hide' : 'Show'} licence text
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(signed);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="text-navy underline underline-offset-2"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(signed)}`}
          download={`${licenceId}.licence`}
          className="text-navy underline underline-offset-2"
        >
          Download
        </a>
      </div>
      {shown && (
        <textarea
          readOnly
          rows={4}
          value={signed}
          className="mt-2 w-full rounded border border-mist p-2 text-[11px] font-mono break-all"
        />
      )}
    </div>
  );
}
