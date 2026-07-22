import Link from 'next/link';
import { api } from '@/lib/api';
import WhatsAppReply from '@/components/WhatsAppReply';
import WhatsAppConnection from '@/components/WhatsAppConnection';

interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  lastMessage: string | null;
  lastInboundAt: string | null;
  minutesLeft: number;
  canReply: boolean;
  /** The assistant has stepped aside and this family was promised a person. */
  needsPerson?: boolean;
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
  const waiting = conversations.filter((x) => x.needsPerson).length;
  const thread = selectedId
    ? await api<Thread>(`/whatsapp/conversations/${selectedId}`).catch(() => null)
    : null;

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">WhatsApp</h1>
        <p className="text-sm text-oat mt-1.5">
          The assistant answers families automatically — fees, attendance, results. Threads land
          here when somebody needs a person.
        </p>
      </div>

      {/* Connecting the school's own number, which used to be possible only by editing the
          server's environment — see WhatsAppConnection. */}
      <WhatsAppConnection />

      {/*
        The two-pane layout only exists once there is something to read.
        With no conversations it was an empty list beside an empty detail panel, both saying the
        same thing in different words — the list is the empty state, so the panel beside it was
        explaining an absence twice.
      */}
      {conversations.length === 0 ? (
        <section className="card p-8 mt-6 rise rise-3 text-center">
          <p className="font-display text-xl">No family has written yet</p>
          <p className="text-sm text-oat mt-2 max-w-md mx-auto">
            The assistant answers most questions on its own. A thread opens here when somebody asks
            for something it cannot answer — and the number is already printed on terminal reports,
            bills and receipts, so there is nothing to hand out.
          </p>
        </section>
      ) : (
        <div className="grid lg:grid-cols-[20rem_1fr] gap-6 mt-6 items-start">
          <section className="card overflow-hidden rise rise-3">
            <div className="px-5 pt-5 pb-3">
              <h2 className="font-display text-xl">Conversations</h2>
              {/* The count that matters is how many families are waiting, not how many threads
                  exist — so it is said first, and only when it is not zero. */}
              <p className="text-xs text-oat mt-1">
                {waiting > 0
                  ? `${waiting} waiting on a person${waiting === conversations.length ? '' : `, of ${conversations.length}`}.`
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
                        {/* Two different facts, told by one label until now: whether the 24-hour
                            window is open, and whether anybody is actually waiting on a person. */}
                        <span
                          className={`text-[10px] uppercase tracking-wider shrink-0 ${
                            c2.needsPerson
                              ? 'text-clay font-medium'
                              : c2.canReply
                                ? 'text-leaf'
                                : 'text-oat'
                          }`}
                        >
                          {c2.needsPerson ? 'Needs a person' : c2.canReply ? 'Open' : 'Closed'}
                        </span>
                      </div>
                      {c2.name && <p className="text-[11px] text-oat tabular">{c2.phone}</p>}
                      {c2.lastMessage && (
                        <p className="text-[12px] text-oat truncate mt-0.5">{c2.lastMessage}</p>
                      )}
                      <p
                        className={`text-[11px] mt-0.5 ${c2.canReply ? 'text-brand' : 'text-oat'}`}
                      >
                        {windowLeft(c2.minutesLeft)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card p-6 rise rise-4">
            {!thread ? (
              // Only reachable when a thread will not load — the empty case is handled above, and a
              // conversation is always selected when one exists.
              <p className="py-10 text-center text-sm text-oat">
                That conversation could not be opened. Choose another from the list.
              </p>
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
                          m.direction === 'OUTBOUND'
                            ? 'bg-brand text-paper'
                            : 'bg-parchment text-ink'
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
                    <WhatsAppReply
                      id={thread.id}
                      minutesLeft={thread.minutesLeft}
                      needsPerson={conversations.find((x) => x.id === thread.id)?.needsPerson}
                    />
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
      )}
    </div>
  );
}
