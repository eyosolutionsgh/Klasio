'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';

interface CarLineState {
  entry: { id: string; status: 'WAITING' | 'CALLED'; announcedAt: string } | null;
  position: number | null;
}

/**
 * "I'm outside" for the afternoon car line. Hidden entirely when the school's package has no
 * car line (the API answers 404). While queued it polls gently, because the only thing a parent
 * wants from this screen is the moment their child is called.
 */
export default function FamilyCarLine() {
  const [state, setState] = useState<CarLineState | null>(null);
  const [available, setAvailable] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/family/guardian/carline');
    if (!res.ok) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setState(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while standing in the queue.
  useEffect(() => {
    if (state?.entry) {
      timer.current = setInterval(load, 15_000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
    return undefined;
  }, [state?.entry, load]);

  const announce = useAsyncAction(async () => {
    const res = await fetch('/api/family/guardian/carline', { method: 'POST' });
    if (!res.ok) throw new Error('rejected');
    setState(await res.json());
  });

  const cancel = useAsyncAction(async () => {
    const res = await fetch('/api/family/guardian/carline', { method: 'DELETE' });
    if (!res.ok) throw new Error('rejected');
    await load();
  });

  if (!available) return null;

  return (
    <section className="card p-6">
      <h2 className="font-display text-xl">Pickup queue</h2>
      {!state?.entry ? (
        <>
          <p className="text-sm text-oat mt-1.5">
            Arriving for pickup? Tell the gate you are outside and they will bring your child out in
            turn.
          </p>
          <Button
            onClick={announce.run}
            state={announce.state}
            pendingLabel="Joining…"
            doneLabel="In the queue!"
            failedLabel="Couldn't join"
            className="w-full mt-4 bg-forest! text-paper hover:bg-forest-deep!"
          >
            I&apos;ve arrived
          </Button>
        </>
      ) : state.entry.status === 'CALLED' ? (
        <div className="mt-3 rounded-lg bg-leaf/10 border border-leaf/20 p-4 text-center">
          <p className="font-display text-2xl text-leaf">You&apos;re up!</p>
          <p className="text-sm text-oat mt-1">
            The gate is bringing your child out now. Please drive forward.
          </p>
        </div>
      ) : (
        <div className="mt-3 text-center">
          <p className="text-[11px] uppercase tracking-widest text-oat">Your place in the queue</p>
          <p className="font-display text-4xl tabular mt-1">{state.position}</p>
          <p className="text-xs text-oat mt-1">
            The school sees you are here. This updates by itself.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={cancel.run}
            state={cancel.state}
            className="mt-2"
          >
            Leave the queue
          </Button>
        </div>
      )}
    </section>
  );
}
