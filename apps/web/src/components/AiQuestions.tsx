'use client';

import { useState } from 'react';
import { Button, useAsyncAction } from './Button';
import { PlusIcon } from './icons';

interface Suggestion {
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

/**
 * §21's question help: the model proposes MCQs for a bank; NOTHING lands until a person adds
 * it, one question at a time, having read it. A wrong AI question in a child's exam is worse
 * than no help at all.
 */
export default function AiQuestions({ bankId, onAdded }: { bankId: string; onAdded: () => void }) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const generate = useAsyncAction(async () => {
    setNote(null);
    const res = await fetch('/api/proxy/ai/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankId, topic: topic.trim(), count }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(d.message ?? 'AI is not available on this server.');
      throw new Error('rejected');
    }
    setSuggestions(d.suggestions);
    if (d.suggestions.length === 0) setNote('Nothing usable came back — try a narrower topic.');
  });

  async function add(s: Suggestion, i: number) {
    setBusy(i);
    const res = await fetch(`/api/proxy/exams/banks/${bankId}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: s.text,
        options: s.options,
        correctIndex: s.correctIndex,
        explanation: s.explanation,
      }),
    });
    setBusy(null);
    if (res.ok) {
      setSuggestions(suggestions.filter((_, j) => j !== i));
      onAdded();
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-mist p-4">
      <p className="text-[11px] uppercase tracking-wider text-oat">Generate with AI</p>
      <p className="text-xs text-oat mt-1">
        Proposals only — read each one, then add what you keep.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic, e.g. Fractions"
          className="flex-1 min-w-[10rem] min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(e) => setCount(parseInt(e.target.value, 10) || 5)}
          className="w-16 min-h-11 rounded-lg border border-mist bg-white px-2 py-2 text-sm tabular outline-none focus:border-brand"
        />
        <Button
          onClick={generate.run}
          state={generate.state}
          disabled={topic.trim().length < 3}
          variant="secondary"
          pendingLabel="Generating…"
          doneLabel="Generated!"
          failedLabel="Couldn't generate"
        >
          Propose questions
        </Button>
      </div>
      {note && <p className="text-xs text-oat mt-2">{note}</p>}
      <ul className="mt-3 space-y-2">
        {suggestions.map((s, i) => (
          <li key={i} className="rounded-lg bg-parchment/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                {s.text}
                <span className="block text-[11px] text-oat mt-0.5">
                  {s.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join('   ')}
                  {' — answer '}
                  {String.fromCharCode(65 + s.correctIndex)}
                </span>
              </div>
              <button
                onClick={() => add(s, i)}
                disabled={busy === i}
                className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline underline-offset-2 disabled:opacity-50"
              >
                <PlusIcon /> Add
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
