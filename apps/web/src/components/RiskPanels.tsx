'use client';

import { useEffect, useState } from 'react';

interface FeeFlag {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  balance: number;
  level: string;
  reasons: string[];
}
interface ChildFlag {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  reasons: string[];
}

/**
 * §21's flags, deterministic and explainable: the panel shows WHY each family or child is
 * flagged, because a school acts on "no payment in nine weeks", not on a score. Suggests only —
 * a person decides. Hidden entirely when the package has no AI insights.
 */
export function DefaultRiskPanel() {
  const [flags, setFlags] = useState<FeeFlag[] | null>(null);

  useEffect(() => {
    fetch('/api/proxy/ai/default-risk')
      .then((r) => (r.ok ? r.json() : null))
      .then(setFlags)
      .catch(() => setFlags(null));
  }, []);

  if (!flags || flags.length === 0) return null;

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Likely to fall behind</h2>
      <p className="text-sm text-oat mt-1.5">
        Flagged from the ledger and reminder history — each with its reasons. A suggestion, not a
        judgement.
      </p>
      <ul className="mt-4 space-y-3">
        {flags.slice(0, 8).map((f) => (
          <li key={f.studentId} className="border-b border-mist/50 last:border-0 pb-2.5 last:pb-0">
            <div className="flex justify-between gap-3">
              <a
                href={`/students/${f.studentId}`}
                className="text-sm font-medium hover:text-brand hover:underline underline-offset-2"
              >
                {f.name}
                <span className="ml-2 text-[11px] text-oat">{f.className ?? ''}</span>
              </a>
              <span
                className={`text-[11px] font-medium uppercase tracking-wider shrink-0 ${
                  f.level === 'HIGH' ? 'text-danger' : 'text-gold'
                }`}
              >
                {f.level.toLowerCase()}
              </span>
            </div>
            <p className="text-[12px] text-oat mt-0.5">
              GHS {f.balance.toLocaleString('en-GH')} — {f.reasons.join('; ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AtRiskPanel() {
  const [flags, setFlags] = useState<ChildFlag[] | null>(null);

  useEffect(() => {
    fetch('/api/proxy/ai/at-risk')
      .then((r) => (r.ok ? r.json() : null))
      .then(setFlags)
      .catch(() => setFlags(null));
  }, []);

  if (!flags || flags.length === 0) return null;

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Children to look at</h2>
      <p className="text-sm text-oat mt-1.5">
        Flagged from attendance and results together — each with its reasons.
      </p>
      <ul className="mt-4 space-y-2.5">
        {flags.slice(0, 10).map((f) => (
          <li key={f.studentId} className="border-b border-mist/50 last:border-0 pb-2 last:pb-0">
            <a
              href={`/students/${f.studentId}`}
              className="text-sm font-medium hover:text-brand hover:underline underline-offset-2"
            >
              {f.name}
              <span className="ml-2 text-[11px] text-oat">{f.className ?? ''}</span>
            </a>
            <p className="text-[12px] text-clay mt-0.5">{f.reasons.join('; ')}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
