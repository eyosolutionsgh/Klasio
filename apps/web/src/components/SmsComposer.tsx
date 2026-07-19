'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { ChoiceCards } from '@/components/ChoiceCards';
import { SendIcon } from '@/components/icons';

type Audience = 'ALL' | 'CLASS' | 'LEVEL' | 'CUSTOM';

export interface ClassOpt {
  id: string;
  name: string;
  studentCount: number;
}
export interface LevelOpt {
  id: string;
  name: string;
}

/**
 * The broadcast composer.
 *
 * Split out of the messaging page when that page became a server component so the send log could
 * page and sort like every other list. Only the form needs to be a client: the credit balance and
 * the log are read on the server, and `router.refresh()` after a send re-reads both — which is
 * also what keeps the credit count honest, since a send debits it.
 */
export default function SmsComposer({
  classes,
  levels,
}: {
  classes: ClassOpt[];
  levels: LevelOpt[];
}) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>('ALL');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [levelId, setLevelId] = useState(levels[0]?.id ?? '');
  const [recipients, setRecipients] = useState('');
  const [body, setBody] = useState('');
  // Failures only — the button reports the send itself, and the balance and log refresh below.
  const [error, setError] = useState<string | null>(null);

  const send = useAsyncAction(async () => {
    setError(null);
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
    if (!res.ok) {
      setError(data.message ?? 'Could not send.');
      throw new Error('rejected');
    }
    setBody('');
    router.refresh();
  });

  const segments = 1 + Math.floor(body.length / 160);

  return (
    <div className="card p-6 space-y-4">
      {/* No icons: only "Custom numbers" has an obvious one, and one iconed card in four reads
          as an error rather than a distinction. */}
      <ChoiceCards
        legend="Send it to"
        name="audience"
        value={audience}
        onChange={setAudience}
        options={[
          { value: 'ALL', label: 'All guardians' },
          { value: 'CLASS', label: 'By class' },
          { value: 'LEVEL', label: 'By level' },
          { value: 'CUSTOM', label: 'Custom numbers' },
        ]}
      />

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
          {body.length} characters · {segments} SMS segment{segments === 1 ? '' : 's'} per recipient
        </p>
        <Button onClick={send.run} state={send.state} disabled={!body.trim()} icon={<SendIcon />}>
          Send SMS
        </Button>
      </div>
      {/* Kept: the button can only say the send failed, not that the school is out of credits. */}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
