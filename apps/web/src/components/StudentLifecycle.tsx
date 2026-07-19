'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { CheckIcon, RefreshIcon } from '@/components/icons';

type Action = 'transfer' | 'withdraw';

const EXIT_WORD: Record<string, string> = {
  TRANSFERRED: 'transferred',
  WITHDRAWN: 'withdrawn',
  GRADUATED: 'graduated',
};

/**
 * Ending a student's time at the school, and undoing it.
 *
 * The lifecycle used to be one-way. `exit()` requires ACTIVE and the update DTO carries no
 * `status`, so a child transferred, withdrawn or graduated by mistake could only be put back by
 * someone with database access — and this panel was hidden entirely once a student left, so the
 * screen offered nothing at all. A mis-clicked "Graduate class" ended forty records, and the
 * head's only recourse was to ring EYO.
 *
 * Reinstating is deliberately not the mirror image of exiting. It asks for a class, because the
 * one stored on the record may have been deleted, renamed or promoted on since — and a returning
 * pupil often belongs in a different year anyway.
 */
export default function StudentLifecycle({
  studentId,
  name,
  status,
}: {
  studentId: string;
  name: string;
  status: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onRoll = status === 'ACTIVE';
  const [reinstating, setReinstating] = useState(false);
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!reinstating) return;
    fetch('/api/proxy/school/structure')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setClasses(d.classes ?? []))
      .catch(() => undefined);
  }, [reinstating]);

  // The error is set *and* rethrown: the message names the reason, the throw is what stops the
  // button showing a tick for a request the API turned down.
  const submit = useAsyncAction(async () => {
    if (!action) return;
    setError(null);
    try {
      const res = await fetch(`/api/proxy/students/${studentId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `${action} failed`);
      }
      setAction(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
      throw e;
    }
  });

  const reinstate = useAsyncAction(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/proxy/students/${studentId}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'Could not put this student back on the roll');
      setReinstating(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not put this student back on the roll');
      throw e;
    }
  });

  // ── Off the roll: the way back ─────────────────────────────────────
  if (!onRoll) {
    if (!reinstating) {
      return (
        <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-oat">
            <span className="font-medium text-ink">{name}</span> is recorded as{' '}
            {EXIT_WORD[status] ?? status.toLowerCase()}. If that was a mistake, they can be put back
            on the roll.
          </p>
          <Button
            variant="secondary"
            icon={<RefreshIcon />}
            className="shrink-0"
            onClick={() => setReinstating(true)}
          >
            Put back on the roll
          </Button>
        </div>
      );
    }
    return (
      <div className="card p-4">
        <p className="text-sm text-oat">
          Put <span className="font-medium text-ink">{name}</span> back on the roll. Their marks,
          attendance and fee history are untouched and come back with them.
        </p>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="w-56">
            <Combobox
              label="Class"
              allowClear={false}
              placeholder="Search classes…"
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              value={classId}
              onChange={setClassId}
            />
          </div>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Why?</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. graduated in error"
              className="min-h-11 rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand w-64"
            />
          </label>
          {/* "Put" is not a verb the labels conjugate, so the wording is given outright. */}
          <Button
            onClick={reinstate.run}
            state={reinstate.state}
            icon={<RefreshIcon />}
            disabled={!classId || reason.trim().length < 4}
            pendingLabel="Working…"
            doneLabel="Back on the roll!"
            failedLabel="Couldn't put them back"
          >
            Put back on the roll
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setReinstating(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-danger mt-3">{error}</p>}
      </div>
    );
  }

  // ── On the roll: the exits ─────────────────────────────────────────
  if (!action) {
    return (
      <div className="flex items-center gap-2">
        {/* Both only open the reason row below — the exit itself is the Confirm button, which is
            where the weight belongs. */}
        <Button
          variant="secondary"
          onClick={() => setAction('transfer')}
          data-tip="Record that this student moved to another school"
        >
          Transfer
        </Button>
        <Button
          variant="secondary"
          onClick={() => setAction('withdraw')}
          data-tip="Record that this student left the school"
        >
          Withdraw
        </Button>
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-wrap items-center gap-3">
      <span className="text-sm text-oat">
        {action === 'transfer' ? 'Transfer' : 'Withdraw'}{' '}
        <span className="font-medium text-ink">{name}</span> — reason (optional)
      </span>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={action === 'transfer' ? 'e.g. relocated to Kumasi' : 'e.g. fees / relocation'}
        className="rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand w-64"
      />
      {/* "Confirm" is not conjugated by the shared labels, so its wording is spelled out. */}
      <Button
        onClick={submit.run}
        state={submit.state}
        icon={<CheckIcon />}
        pendingLabel="Working…"
        doneLabel={action === 'transfer' ? 'Transferred!' : 'Withdrawn!'}
        failedLabel={`Couldn't ${action}`}
      >
        {`Confirm ${action}`}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setAction(null);
          setError(null);
        }}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-danger w-full">{error}</span>}
    </div>
  );
}
