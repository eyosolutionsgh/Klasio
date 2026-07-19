'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';
import { SendIcon } from '@/components/icons';

interface Notice {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

export default function AnnouncementsPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/announcements');
    setNotices(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.message ?? 'Could not post the notice.');
      throw new Error('rejected');
    }
    setTitle('');
    setBody('');
    await load();
  });

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Announcements</h1>
        <p className="text-sm text-oat mt-1.5">
          Notices appear on the dashboard and the guardian portal.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 mt-8">
        <form onSubmit={post.run} className="card p-6 h-fit rise rise-2">
          <h2 className="font-display text-xl">Post a notice</h2>
          <label className="block text-sm font-medium mt-5 mb-1.5" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            required
            minLength={3}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. PTA meeting on Saturday"
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="body">
            Message
          </label>
          <textarea
            id="body"
            required
            minLength={3}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the full notice here…"
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 resize-y"
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
          {/* "Post" is not one of the conjugated verbs, so the wording is spelled out. */}
          <Button
            type="submit"
            state={post.state}
            icon={<SendIcon />}
            pendingLabel="Posting…"
            doneLabel="Posted!"
            failedLabel="Couldn't post"
            className="mt-5"
          >
            Post notice
          </Button>
        </form>

        <section className="space-y-4">
          {notices.map((n, i) => (
            <article key={n.id} className={`card card-accent p-5 rise rise-${Math.min(4, i + 1)}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-display text-lg leading-snug">{n.title}</h3>
                <time className="text-[11px] text-oat whitespace-nowrap tabular">
                  {new Date(n.publishedAt).toLocaleDateString('en-GH', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </time>
              </div>
              <p className="text-sm text-ink/80 mt-2 leading-relaxed">{n.body}</p>
            </article>
          ))}
          {notices.length === 0 && <p className="text-sm text-oat p-4">No notices yet.</p>}
        </section>
      </div>
    </div>
  );
}
