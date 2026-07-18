'use client';

import { useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import SmsTopUp from '@/components/SmsTopUp';

type Audience = 'ALL' | 'CLASS' | 'LEVEL' | 'CUSTOM';
interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}
interface LevelOpt {
  id: string;
  name: string;
}
interface Balance {
  credits: number;
  senderId: string | null;
  provider: string;
}
interface Message {
  id: string;
  to: string;
  body: string;
  status: string;
  batchId: string | null;
  error: string | null;
  createdAt: string;
}

export default function MessagingPage() {
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [levels, setLevels] = useState<LevelOpt[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Only the head and the owner may record a purchase, so only they are shown the control.
  const [canTopUp, setCanTopUp] = useState(false);

  const [audience, setAudience] = useState<Audience>('ALL');
  const [classId, setClassId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [recipients, setRecipients] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMeta() {
    const [s, b, m, me] = await Promise.all([
      fetch('/api/proxy/school/structure').then((r) => r.json()),
      fetch('/api/proxy/sms/balance').then((r) => r.json()),
      fetch('/api/proxy/sms/messages').then((r) => r.json()),
      fetch('/api/proxy/me').then((r) => r.json()),
    ]);
    setCanTopUp(['OWNER', 'HEAD'].includes(me?.user?.role));
    const withStudents = s.classes.filter((c: ClassOpt) => c.studentCount > 0);
    setClasses(withStudents);
    setLevels(s.levels);
    if (withStudents[0]) setClassId(withStudents[0].id);
    if (s.levels[0]) setLevelId(s.levels[0].id);
    setBalance(b);
    setMessages(Array.isArray(m) ? m : []);
  }

  useEffect(() => {
    loadMeta();
  }, []);

  async function send() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/proxy/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience,
        body,
        classId: audience === 'CLASS' ? classId : undefined,
        levelId: audience === 'LEVEL' ? levelId : undefined,
        recipients:
          audience === 'CUSTOM'
            ? recipients
                .split(/[\s,]+/)
                .map((r) => r.trim())
                .filter(Boolean)
            : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage(`Sent ${data.sent} of ${data.recipients}. ${data.creditsRemaining} credits left.`);
      setBody('');
      loadMeta();
    } else {
      setMessage(data.message ?? 'Could not send.');
    }
  }

  const segments = 1 + Math.floor(body.length / 160);

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Messaging</h1>
          <p className="text-sm text-oat mt-1.5">
            Bulk SMS to guardians. Pay-as-you-go — one credit per recipient.
          </p>
        </div>
        {balance && (
          <div className="card px-5 py-3 text-right">
            <p className="text-[11px] uppercase tracking-widest text-oat">SMS credits</p>
            <p className="font-display text-2xl tabular mt-1 text-brand">{balance.credits}</p>
            <p className="text-[11px] text-oat">
              Sender {balance.senderId ?? '—'} · {balance.provider}
            </p>
          </div>
        )}
      </div>

      {canTopUp && (
        <div className="mt-3 flex justify-end">
          <SmsTopUp onDone={loadMeta} />
        </div>
      )}

      <div className="card p-6 mt-6 rise rise-2 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'CLASS', 'LEVEL', 'CUSTOM'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAudience(a)}
              className={`text-[13px] rounded-full px-3.5 py-1.5 border transition ${audience === a ? 'bg-brand text-paper border-brand' : 'border-mist bg-white text-ink hover:border-brand'}`}
            >
              {a === 'ALL'
                ? 'All guardians'
                : a === 'CLASS'
                  ? 'By class'
                  : a === 'LEVEL'
                    ? 'By level'
                    : 'Custom numbers'}
            </button>
          ))}
        </div>

        {audience === 'CLASS' && (
          <Combobox
            label="Class"
            className="w-full sm:w-64"
            allowClear={false}
            placeholder="Search classes…"
            options={classes.map((c) => ({
              value: c.id,
              label: c.name,
              hint: `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`,
            }))}
            value={classId}
            onChange={setClassId}
          />
        )}
        {audience === 'LEVEL' && (
          <Combobox
            label="Level"
            className="w-full sm:w-64"
            allowClear={false}
            placeholder="Search levels…"
            options={levels.map((l) => ({ value: l.id, label: l.name }))}
            value={levelId}
            onChange={setLevelId}
          />
        )}
        {audience === 'CUSTOM' && (
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="Phone numbers, comma or space separated (e.g. 0241234567, 233201112222)"
            rows={2}
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
          />
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type your message to guardians…"
          rows={4}
          className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-xs text-oat">
            {body.length} characters · {segments} SMS segment{segments === 1 ? '' : 's'} per
            recipient
          </p>
          <button
            onClick={send}
            disabled={busy || !body.trim()}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
        {message && <p className="text-sm text-brand">{message}</p>}
      </div>

      <h2 className="font-display text-xl mt-8 rise rise-3">Recent messages</h2>
      <div className="card mt-3 overflow-x-auto rise rise-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">To</th>
              <th className="px-5 py-3 font-medium">Message</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} className="border-b border-mist/60 last:border-0">
                <td className="px-5 py-2.5 tabular text-oat">{m.to}</td>
                <td className="px-5 py-2.5 max-w-md truncate" title={m.body}>
                  {m.body}
                </td>
                <td className="px-5 py-2.5">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${m.status === 'SENT' ? 'bg-brand-mist text-brand' : m.status === 'FAILED' ? 'bg-danger/10 text-danger' : 'bg-parchment text-oat'}`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-oat text-xs tabular whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleString('en-GH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
            {messages.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No messages sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
