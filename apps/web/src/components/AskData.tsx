'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { SearchIcon } from './icons';

interface Answer {
  answer: string;
  rows: { label: string; value: number }[];
  unit?: string;
}

/**
 * "Ask your own data" (FEATURES.md §19/§21). The model only ever picks one of a fixed set of
 * safe reports; the numbers come from the same queries the dashboards use, and with no model
 * configured a keyword match answers the same questions. Never raw SQL, never a guess.
 */
export default function AskData() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Answer | null>(null);
  const [hidden, setHidden] = useState(false);

  const ask = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault?.();
    if (!question.trim()) return;
    const res = await fetch('/api/proxy/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim() }),
    });
    if (res.status === 403 || res.status === 404) {
      setHidden(true);
      return;
    }
    if (!res.ok) throw new Error('rejected');
    setResult(await res.json());
  });

  if (hidden) return null;

  const max = Math.max(1, ...(result?.rows.map((r) => r.value) ?? [1]));

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Ask your data</h2>
      <p className="text-sm text-oat mt-1.5">
        Try &ldquo;which classes are furthest behind on fees this term?&rdquo;
      </p>
      <form onSubmit={ask.run} className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
            <SearchIcon />
          </span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask in plain English…"
            className="w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 pl-10 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </div>
        <Button
          type="submit"
          state={ask.state}
          disabled={!question.trim()}
          pendingLabel="Thinking…"
          doneLabel="Answered"
          failedLabel="Couldn't answer"
        >
          Ask
        </Button>
      </form>
      {result && (
        <div className="mt-4">
          <p className="text-sm font-medium">{result.answer}</p>
          {result.rows.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {result.rows.slice(0, 10).map((r) => (
                <li key={r.label} className="flex items-center gap-3 text-[13px]">
                  <span className="w-28 truncate shrink-0">{r.label}</span>
                  <span className="flex-1 h-2 rounded-full bg-parchment overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${(r.value / max) * 100}%` }}
                    />
                  </span>
                  <span className="tabular text-oat shrink-0">
                    {r.value.toLocaleString('en-GH')}
                    {result.unit === '%' ? '%' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
