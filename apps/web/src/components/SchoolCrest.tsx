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

  if (hasLogo && !failed) {
    return (
      <img
        src="/api/proxy/school/logo"
        alt={`${name} crest`}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        // No plate behind the crest: a school's mark is usually cut out to sit on whatever is
        // under it, and the white rounded tile this used to add read as part of the logo.
        // Trade-off worth knowing — a school whose crest is itself dark now has less contrast
        // against the dark sidebar. The initials fallback below still keeps its tile, because
        // letters need one.
        className="object-contain shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-md grid place-items-center text-[13px] font-medium ${
        onDark ? 'bg-paper/15 text-gold' : 'bg-brand text-paper'
      }`}
    >
      {letters}
    </span>
  );
}
