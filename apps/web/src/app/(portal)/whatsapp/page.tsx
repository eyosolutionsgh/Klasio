import Link from 'next/link';
import { api } from '@/lib/api';
import WhatsAppReply from '@/components/WhatsAppReply';

interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  lastMessage: string | null;
  lastInboundAt: string | null;
  minutesLeft: number;
  canReply: boolean;
}
interface Thread {
  id: string;
  phone: string;
  name: string | null;
  canReply: boolean;
  /** A human sentence from the API when the school may not reply. Shown verbatim. */
  blockedReason: string | null;
  minutesLeft: number;
  messages: { id: string; direction: 'INBOUND' | 'OUTBOUND'; body: string; createdAt: string }[];
}

/** How much of the 24-hour window is left, said the way a front desk would say it. */
function windowLeft(minutes: number) {
  if (minutes <= 0) return 'Window closed';
  if (minutes < 60) return `${minutes} min left to reply`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m left to reply`;
}

const time = (d: string) =>
  new Date(d).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const conversations = await api<Conversation[]>('/whatsapp/conversations');
  // Falling back to the most recent thread means the panel is never an empty box next to a
  // populated list.
  const selectedId = c ?? conversations[0]?.id;
  const thread = selectedId
    ? await api<Thread>(`/whatsapp/conversations/${selectedId}`).catch(() => null)
    : null;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">WhatsApp</h1>
        <p className="text-sm text-oat mt-1.5">
          Replies to families who have written to the school. Every conversation here was started by
          a parent.
        </p>
      </div>

      {/*
        Stated once, plainly, at the top — because the absence of a compose button is a deliberate
        product decision and an unexplained absence just reads as a missing feature.
      */}
      <div className="card p-5 mt-6 rise rise-2 border-l-[3px] border-l-gold">
        <p className="text-sm font-medium">The school cannot start a WhatsApp conversation.</p>
        <p className="text-[13px] text-oat mt-1.5">
          WhatsApp is a family&apos;s personal channel. A parent who has not written to you has not
          asked to be reached on it, so there is no way to compose a new message here — by design,
          not by omission. Once a parent writes in, you may reply freely for 24 hours; after that
          the window shuts and WhatsApp will not deliver. Anything you need to send unprompted —
          notices, fee reminders, absence alerts — goes by SMS, where the number was given to you
          for exactly that.
        </p>
      </div>

      <div className="grid lg:grid-cols-[20rem_1fr] gap-6 mt-6 items-start">
        <section className="card overflow-hidden rise rise-3">
          <div className="px-5 pt-5 pb-3">
            <h2 className="font-display text-xl">Conversations</h2>
            <p className="text-xs text-oat mt-1">
              {conversations.length === 0
                ? 'None yet.'
                : `${conversations.length} thread${conversations.length === 1 ? '' : 's'}, most recent first.`}
            </p>
          </div>
          <ul>
            {conversations.map((c2) => {
              const active = c2.id === selectedId;
              return (
                <li key={c2.id}>
                  <Link
                    href={`/whatsapp?c=${c2.id}`}
                    className={`block px-5 py-3 border-t border-mist/60 transition ${
                      active ? 'bg-brand-mist' : 'hover:bg-parchment/60'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium truncate">{c2.name ?? c2.phone}</span>
                      <span
                        className={`text-[10px] uppercase tracking-wider shrink-0 ${
                          c2.canReply ? 'text-leaf' : 'text-oat'
                        }`}
                      >
                        {c2.canReply ? 'Open' : 'Closed'}
                      </span>
                    </div>
                    {c2.name && <p className="text-[11px] text-oat tabular">{c2.phone}</p>}
                    {c2.lastMessage && (
                      <p className="text-[12px] text-oat truncate mt-0.5">{c2.lastMessage}</p>
                    )}
                    <p className={`text-[11px] mt-0.5 ${c2.canReply ? 'text-brand' : 'text-oat'}`}>
                      {windowLeft(c2.minutesLeft)}
                    </p>
                  </Link>
                </li>
              );
            })}
            {conversations.length === 0 && (
              <li className="px-5 pb-6 text-sm text-oat border-t border-mist/60 pt-4">
                No family has messaged the school on WhatsApp yet. Threads appear here on their own
                the moment one does — put your WhatsApp number on report cards, invoices and the
                school gate so parents know they can write to it.
              </li>
            )}
          </ul>
        </section>

        <section className="card p-6 rise rise-4">
          {!thread ? (
            <div className="py-10 text-center">
              <p className="font-display text-xl">Nothing to answer</p>
              <p className="text-sm text-oat mt-2 max-w-md mx-auto">
                When a parent messages your WhatsApp number their thread opens here and the 24-hour
                reply window starts. There is nothing to set up, and nothing to send first.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div>
                  <h2 className="font-display text-xl">{thread.name ?? thread.phone}</h2>
                  <p className="text-[12px] text-oat tabular">{thread.phone}</p>
                </div>
                <span
                  className={`text-[11px] uppercase tracking-wider rounded-full px-2.5 py-1 ${
                    thread.canReply ? 'bg-leaf/10 text-leaf' : 'bg-parchment text-oat'
                  }`}
                >
                  {windowLeft(thread.minutesLeft)}
                </span>
              </div>

              <ul className="mt-5 space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                {thread.messages.map((m) => (
                  <li
                    key={m.id}
                    className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3.5 py-2 ${
                        m.direction === 'OUTBOUND' ? 'bg-brand text-paper' : 'bg-parchment text-ink'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`text-[10px] mt-1 tabular ${
                          m.direction === 'OUTBOUND' ? 'text-paper/60' : 'text-oat'
                        }`}
                      >
                        {m.direction === 'OUTBOUND' ? 'School' : 'Them'} · {time(m.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
                {thread.messages.length === 0 && (
                  <li className="text-sm text-oat">No messages on this thread.</li>
                )}
              </ul>

              <div className="mt-5 pt-5 border-t border-mist/60">
                {thread.canReply ? (
                  <WhatsAppReply id={thread.id} minutesLeft={thread.minutesLeft} />
                ) : (
                  /* The API hands back a sentence explaining why, so it is shown instead of a
                     dead button — a disabled control teaches the front office nothing. */
                  <div className="rounded-lg border border-clay/30 bg-clay/5 p-4">
                    <p className="text-[13px] text-clay font-medium">You cannot reply here</p>
                    <p className="text-[13px] text-ink/80 mt-1">
                      {thread.blockedReason ??
                        'The 24-hour reply window has closed. Send an SMS instead.'}
                    </p>
                    <Link
                      href="/messaging"
                      className="inline-block mt-3 text-[12.5px] font-medium text-brand border border-brand/40 rounded-full px-3 py-1 hover:bg-brand-mist transition"
                    >
                      Send an SMS instead
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
