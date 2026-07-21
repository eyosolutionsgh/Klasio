import { api, getMe } from '@/lib/api';
import SmsComposer, { type ClassOpt, type LevelOpt } from '@/components/SmsComposer';
import SmsTopUp from '@/components/SmsTopUp';
import MessageFilters from '@/components/MessageFilters';
import AutoMessages from '@/components/AutoMessages';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { Button } from '@/components/Button';
import { SearchIcon } from '@/components/icons';
import { apiQuery, one, type ListSearchParams, type Page } from '@/lib/list';

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
interface Structure {
  classes: ClassOpt[];
  levels: LevelOpt[];
}

export default async function MessagingPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const q = one(params.q);
  // The log's own filters, plus the paging/sorting/date keys `apiQuery` always forwards.
  const qs = apiQuery(params, ['status', 'q']);

  const [structure, balance, messages, me] = await Promise.all([
    api<Structure>('/school/structure'),
    api<Balance>('/sms/balance'),
    api<Page<Message>>(`/sms/messages?${qs}`),
    getMe(),
  ]);

  // Only the head and the owner may record a purchase, so only they are shown the control.
  const canTopUp = ['OWNER', 'HEAD'].includes(me.user.role);
  // A class with nobody in it cannot be an audience — offering it only produces "No recipients
  // matched" after the message has been written.
  const classes = structure.classes.filter((c) => c.studentCount > 0);

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Messaging</h1>
          <p className="text-sm text-oat mt-1.5">
            Bulk SMS to guardians. Pay-as-you-go — one credit per recipient.
          </p>
        </div>
        <div className="card px-5 py-3 text-right">
          <p className="text-[11px] uppercase tracking-widest text-oat">SMS credits</p>
          <p className="font-display text-2xl tabular mt-1 text-brand">{balance.credits}</p>
          <p className="text-[11px] text-oat">
            Sender {balance.senderId ?? '—'} · {balance.provider}
          </p>
        </div>
      </div>

      {canTopUp && (
        <div className="mt-3 flex justify-end">
          <SmsTopUp />
        </div>
      )}

      <div className="mt-6 rise rise-2">
        <SmsComposer classes={classes} levels={structure.levels} />
      </div>

      <div className="mt-6">
        <AutoMessages />
      </div>

      <div className="mt-8 rise rise-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl">Recent messages</h2>
          <p className="text-sm text-oat mt-1">{messages.total} matching</p>
        </div>
        <form className="flex gap-2" action="/messaging" method="get">
          {/*
            A GET form submits only its own fields, so every filter not represented here is dropped
            on search. Carrying them as hidden inputs is what keeps "search within the failures"
            from silently becoming "search everything". `page` is deliberately not carried — a new
            search starts at the beginning.
          */}
          {(['status', 'sort', 'order', 'from', 'to', 'perPage'] as const).map((k) => {
            const v = one(params[k]);
            return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
          })}
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
              <SearchIcon />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search number or message"
              className="w-full rounded-lg border border-mist bg-white pl-10 pr-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      <div className="mt-4 rise rise-3">
        <MessageFilters params={params} />
      </div>

      <div className="card mt-4 overflow-x-auto rise rise-3 table-stack-wrap">
        <table className="w-full text-sm table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="to" base="/messaging" params={params}>
                To
              </SortHeader>
              {/*
                Not sortable: alphabetising a broadcast by its own text answers no question, and it
                would scatter the recipients of one send across the list.
              */}
              <th scope="col" className="px-5 py-3 font-medium">
                Message
              </th>
              <SortHeader column="status" base="/messaging" params={params}>
                Status
              </SortHeader>
              <SortHeader column="createdAt" base="/messaging" params={params} defaultOrder="desc">
                When
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {messages.rows.map((m) => (
              <tr key={m.id} className="border-b border-mist/60 last:border-0">
                <td data-label="To" className="px-5 py-2.5 tabular text-oat">
                  {m.to}
                </td>
                <td data-label="Message" className="px-5 py-2.5 max-w-md truncate" title={m.body}>
                  {m.body}
                </td>
                <td data-label="Status" className="px-5 py-2.5">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${m.status === 'SENT' ? 'bg-brand-mist text-brand' : m.status === 'FAILED' ? 'bg-danger/10 text-danger' : 'bg-parchment text-oat'}`}
                  >
                    {m.status}
                  </span>
                </td>
                <td
                  data-label="When"
                  className="px-5 py-2.5 text-oat text-xs tabular whitespace-nowrap"
                >
                  {new Date(m.createdAt).toLocaleString('en-GH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
            {messages.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No messages match. Try a different status, date range or search term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={messages} base="/messaging" params={params} label="messages" />
      </div>
    </div>
  );
}
