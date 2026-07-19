'use client';

import { useState } from 'react';

/**
 * The school's crest, falling back to its initials. The image is fetched through the
 * authenticated proxy — logos live in the same tenant-scoped storage as student photos and
 * are never exposed on a public URL.
 */
export default function SchoolCrest({
  name,
  hasLogo,
  size = 36,
  onDark = false,
}: {
  name: string;
  hasLogo: boolean;
  size?: number;
  onDark?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  // Scaled from `size` rather than fixed: this renders at 34px in the top bar and 76px in the
  // sidebar, and a radius that looks right at one is wrong at the other.
  const radius = Math.round(size * 0.22);
  // Just enough to keep the artwork off the rounded corners — the crest should read as filling
  // the tile, not sitting in the middle of one.
  const pad = Math.max(1, Math.round(size * 0.05));

  if (hasLogo && !failed) {
    return (
      /**
       * A white plate behind the crest.
       *
       * Schools upload whatever they have, and most crests are dark or deeply coloured on a
       * transparent background — exactly the ones that disappear against the dark sidebar with
       * nothing behind them. A consistent white tile means the portal renders any of them
       * legibly instead of being right for some schools and broken for others.
       *
       * The inset matters: sat flush to the edge the artwork reads as a cropped sticker rather
       * than a mark on a card. The hairline ring gives the tile an edge on light surfaces, where
       * white on near-white would otherwise float.
       */
      <span
        className="shrink-0 grid place-items-center bg-white ring-1 ring-ink/10 shadow-sm"
        style={{ width: size, height: size, borderRadius: radius, padding: pad }}
      >
        <img
          src="/api/proxy/school/logo"
          alt={`${name} crest`}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain"
        />
      </span>
    );
  }

  // Radius and lettering scale with `size` for the same reason the plate above does — this used
  // to be a fixed 13px, which is a small letter marooned in a 76px tile in the sidebar.
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.34) }}
      className={`shrink-0 grid place-items-center font-medium leading-none ${
        onDark ? 'bg-paper/15 text-paper' : 'bg-brand text-paper'
      }`}
    >
      {letters}
    </span>
  );
}
