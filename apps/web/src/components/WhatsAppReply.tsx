'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { SendIcon } from './icons';

/**
 * Reply to a family, inside the open window.
 *
 * There is no counterpart to this component for starting a conversation, and there should never
 * be one: the school only ever answers. The window can also shut between page load and send, so
 * a refusal from the server is shown as the sentence it returns rather than swallowed.
 */
export default function WhatsAppReply({ id, minutesLeft }: { id: string; minutesLeft: number }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useAsyncAction(async () => {
    if (!body.trim()) return;
    setError(null);
    const res = await fetch(`/api/proxy/whatsapp/conversations/${id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // A shut window is refused in the server's own words — that sentence is the whole point
      // of the failure, so it survives the button taking over the status.
      setError(
        Array.isArray(data.message)
          ? data.message.join('. ')
          : (data.message ?? 'Could not send that reply.'),
      );
      throw new Error('rejected');
    }
    setBody('');
    router.refresh();
  });

  return (
    <form onSubmit={send.run}>
      <label className="block text-[13px]" htmlFor="wa-reply">
        <span className="block text-oat mb-1">Reply</span>
        <textarea
          id="wa-reply"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type your reply…"
          className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 resize-y"
        />
      </label>
      <p className="text-[11px] text-oat mt-1">
        {minutesLeft < 60
          ? `Only ${minutesLeft} minutes of the 24-hour window remain — after that WhatsApp will not deliver a reply.`
          : 'You can reply freely until the 24-hour window since their last message runs out.'}
      </p>

      {error && (
        <p role="alert" className="text-sm text-danger mt-2">
          {error}
        </p>
      )}

      {/* The empty-body disable is validation, not busy state — Button owns the latter only. */}
      <Button
        type="submit"
        state={send.state}
        icon={<SendIcon />}
        disabled={!body.trim()}
        className="mt-3"
      >
        Send reply
      </Button>
    </form>
  );
}
