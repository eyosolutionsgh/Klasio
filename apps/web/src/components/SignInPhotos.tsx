'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { AlertIcon, TrashIcon, UploadIcon } from '@/components/icons';

/**
 * The pictures on the school's own sign-in pages.
 *
 * The product ships stock photographs so a fresh install does not look unfinished, but they are
 * pictures of somebody else's school. A school's own gate, its own hall, its own courtyard is
 * better than any stock library — it is true, and it is the first thing a parent sees.
 *
 * Uploads take effect immediately rather than on a Save, which is why this sits outside the
 * profile form: there is nothing to reconcile, and a picture is either replaced or it is not.
 */
interface Photo {
  slot: string;
  filename: string;
  updatedAt: string;
}

const SLOTS = [
  {
    slot: 'STAFF',
    label: 'Staff sign-in',
    hint: 'What teachers and the office see each morning',
  },
  {
    slot: 'FAMILY',
    label: 'Guardian sign-in',
    hint: 'The first thing a parent sees of your school',
  },
  { slot: 'STUDENT', label: 'Student sign-in', hint: 'Where pupils sign in to see their reports' },
  {
    slot: 'GENERAL',
    label: 'Password & setup pages',
    hint: 'Quieter pages nobody visits on purpose',
  },
] as const;

export default function SignInPhotos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every change so the browser refetches rather than showing the cached picture —
  // replacing an image and seeing the old one is the single most confusing outcome here.
  const [stamp, setStamp] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/school/photos');
    if (res.ok) setPhotos(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const upload = useAsyncAction(async (slot: string, file: File) => {
    setError(null);
    const form = new FormData();
    form.set('file', file);
    const res = await fetch(`/api/proxy/school/photos/${slot}`, { method: 'POST', body: form });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? 'That picture could not be uploaded.');
      throw new Error('rejected');
    }
    setStamp((s) => s + 1);
    await load();
  });

  const reset = useAsyncAction(async (slot: string) => {
    setError(null);
    const res = await fetch(`/api/proxy/school/photos/${slot}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('rejected');
    setStamp((s) => s + 1);
    await load();
  });

  const has = (slot: string) => photos.some((p) => p.slot === slot);

  return (
    <section className="card p-6 mt-6 rise rise-4 max-w-3xl">
      <h2 className="font-display text-xl">Sign-in pictures</h2>
      <p className="text-sm text-oat mt-1.5">
        The photograph beside each sign-in form. We ship a stock picture for each one — replace it
        with your own and families see your school rather than a stranger&apos;s. Landscape works
        best; anything wider than about 1400 pixels is more than the page can show.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger flex gap-2">
          <AlertIcon aria-hidden />
          <span>{error}</span>
        </p>
      )}

      <ul className="mt-5 grid sm:grid-cols-2 gap-4">
        {SLOTS.map((s) => {
          const mine = has(s.slot);
          return (
            <li key={s.slot} className="rounded-lg border border-mist bg-white overflow-hidden">
              {/*
                The real thing, at the aspect it is actually shown in, and behind the same scrim
                the sign-in page uses. A preview that looked brighter than the live page would send
                schools hunting for a fault that is not there.
              */}
              <div className="relative aspect-[4/3] bg-forest-deep">
                <img
                  src={
                    mine
                      ? `/api/branding/photo/${s.slot}?v=${stamp}`
                      : s.slot === 'STAFF'
                        ? '/photos/auth/schoolyard-800.webp'
                        : '/photos/auth/courtyard-800.webp'
                  }
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/90 via-forest-deep/75 to-forest-deep/45" />
                <span className="absolute bottom-2 left-3 text-[11px] uppercase tracking-wider text-paper/80">
                  {mine ? 'Your picture' : 'Default'}
                </span>
              </div>

              <div className="p-3.5">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-oat mt-0.5 leading-snug">{s.hint}</p>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-mist bg-white px-2.5 py-1.5 text-xs cursor-pointer hover:bg-parchment/60 min-h-9">
                    <UploadIcon aria-hidden />
                    {mine ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload.run(s.slot, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {/*
                    Only offered when there is something to undo. "Use the default" rather than
                    "Delete": nothing is lost, the page simply goes back to the shipped picture.
                  */}
                  {mine && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      state={reset.state}
                      onClick={() => reset.run(s.slot)}
                      pendingLabel="Removing…"
                      doneLabel="Reset"
                      icon={<TrashIcon aria-hidden />}
                    >
                      Use the default
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
