'use client';

import { useCallback, useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { PlusIcon } from '@/components/icons';
import ConfirmButton from '@/components/ConfirmButton';

/**
 * Boarding (housing.boarding): houses and rooms, who is in which bed, and the exeat book.
 *
 * The whole picture on one screen, the way a house master keeps it — because assigning a bed,
 * signing a boarder out for the weekend and checking who is overdue back are the same job in the
 * same ten minutes, not three separate errands across the menu.
 */
interface Boarder {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
}
interface Room {
  id: string;
  name: string;
  capacity: number;
  occupied: number;
  boarders: Boarder[];
}
interface House {
  id: string;
  name: string;
  kind: 'BOYS' | 'GIRLS' | 'MIXED';
  wardenId: string | null;
  warden: string | null;
  rooms: Room[];
}
interface Overview {
  stats: { houses: number; boarders: number; beds: number };
  houses: House[];
}
interface Exeat {
  id: string;
  studentId: string;
  name: string;
  admissionNo: string | null;
  reason: string;
  destination: string | null;
  outAt: string;
  dueBackAt: string;
  returnedAt: string | null;
  overdue: boolean;
}

const field =
  'min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' }) : '—';

const KIND_LABEL = { BOYS: 'Boys', GIRLS: 'Girls', MIXED: 'Mixed' } as const;

export default function HostelPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [exeats, setExeats] = useState<Exeat[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, e] = await Promise.all([
      fetch('/api/proxy/housing'),
      fetch('/api/proxy/housing/exeats'),
    ]);
    if (o.ok) setData(await o.json());
    if (e.ok) setExeats(await e.json());
  }, []);

  useEffect(() => {
    load();
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanManage((me?.permissions ?? []).includes('housing.manage')))
      .catch(() => {});
    fetch('/api/proxy/users')
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setStaff((u?.rows ?? u ?? []).map((x: { id: string; name: string }) => x)))
      .catch(() => {});
  }, [load]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setError(null);
    const res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(d.message) ? d.message.join('. ') : (d.message ?? 'That did not work.'),
      );
      throw new Error('rejected');
    }
    await load();
    return d;
  }

  // ── add house ──
  const [houseName, setHouseName] = useState('');
  const [houseKind, setHouseKind] = useState<'BOYS' | 'GIRLS' | 'MIXED'>('MIXED');
  const [houseWarden, setHouseWarden] = useState('');
  const addHouse = useAsyncAction(async () => {
    await send('/housing/houses', { name: houseName, kind: houseKind, wardenId: houseWarden });
    setHouseName('');
    setHouseWarden('');
  });

  const boarders = (data?.houses ?? []).flatMap((h) =>
    h.rooms.flatMap((r) => r.boarders.map((b) => ({ ...b, room: `${h.name} · ${r.name}` }))),
  );

  return (
    <div className="max-w-4xl">
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Boarding</h1>
        <p className="text-sm text-oat mt-1.5 max-w-prose">
          Houses and rooms, who sleeps in which bed, and the exeat book — every boarder signed out
          and, later, signed back in.
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {data && (
        <div className="mt-6 grid grid-cols-3 gap-4 rise rise-2">
          {[
            ['Houses', data.stats.houses],
            ['Boarders', data.stats.boarders],
            ['Beds', data.stats.beds],
          ].map(([label, n]) => (
            <div key={label} className="card p-4">
              <p className="text-[11px] uppercase tracking-wider text-oat">{label}</p>
              <p className="font-display text-2xl mt-1 tabular">{n}</p>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <section className="card p-5 mt-6">
          <h2 className="font-display text-lg">Add a house</h2>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              addHouse.run();
            }}
          >
            <label className="text-[12px] text-oat">
              Name
              <input
                className={`${field} mt-1 block`}
                placeholder="Livingstone House"
                value={houseName}
                onChange={(e) => setHouseName(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-oat">
              Kind
              <select
                className={`${field} mt-1 block`}
                value={houseKind}
                onChange={(e) => setHouseKind(e.target.value as typeof houseKind)}
              >
                <option value="MIXED">Mixed</option>
                <option value="BOYS">Boys</option>
                <option value="GIRLS">Girls</option>
              </select>
            </label>
            <div className="w-56">
              <Combobox
                label="House master / matron"
                options={staff.map((s) => ({ value: s.id, label: s.name }))}
                value={houseWarden}
                onChange={setHouseWarden}
                placeholder="Optional…"
                allowClear
                clearLabel="No warden yet"
              />
            </div>
            <Button
              size="sm"
              icon={<PlusIcon />}
              state={addHouse.state}
              disabled={!houseName.trim()}
            >
              Add house
            </Button>
          </form>
        </section>
      )}

      <div className="mt-6 space-y-5">
        {data?.houses.map((house) => (
          <HouseCard key={house.id} house={house} canManage={canManage} send={send} />
        ))}
        {data && data.houses.length === 0 && (
          <p className="card p-6 text-sm text-oat">
            No houses yet.{canManage ? ' Add one above to begin.' : ''}
          </p>
        )}
      </div>

      <ExeatBook exeats={exeats} boarders={boarders} canManage={canManage} send={send} />
    </div>
  );
}

function HouseCard({
  house,
  canManage,
  send,
}: {
  house: House;
  canManage: boolean;
  send: (path: string, body?: unknown, method?: string) => Promise<unknown>;
}) {
  const [roomName, setRoomName] = useState('');
  const [roomCap, setRoomCap] = useState('4');
  const addRoom = useAsyncAction(async () => {
    await send(`/housing/houses/${house.id}/rooms`, {
      name: roomName,
      capacity: Number(roomCap) || 1,
    });
    setRoomName('');
  });

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg">
            {house.name}{' '}
            <span className="text-[11px] align-middle rounded-full bg-brand-mist text-brand px-2 py-0.5">
              {KIND_LABEL[house.kind]}
            </span>
          </h2>
          <p className="text-[12px] text-oat mt-0.5">
            {house.warden ? `House master: ${house.warden}` : 'No house master set'}
          </p>
        </div>
        {canManage && (
          <ConfirmButton
            label="Delete house"
            question={`Delete ${house.name}?`}
            confirmLabel="Delete"
            danger
            triggerClassName="text-[12px] text-clay hover:underline underline-offset-2"
            onConfirm={() => send(`/housing/houses/${house.id}`, undefined, 'DELETE')}
          />
        )}
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        {house.rooms.map((room) => (
          <RoomCard key={room.id} room={room} canManage={canManage} send={send} />
        ))}
        {house.rooms.length === 0 && (
          <p className="text-[13px] text-oat">No rooms in this house yet.</p>
        )}
      </div>

      {canManage && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-mist/50 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            addRoom.run();
          }}
        >
          <label className="text-[12px] text-oat">
            Room
            <input
              className={`${field} mt-1 block w-40`}
              placeholder="Dormitory A"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </label>
          <label className="text-[12px] text-oat">
            Beds
            <input
              type="number"
              min={1}
              className={`${field} mt-1 block w-20`}
              value={roomCap}
              onChange={(e) => setRoomCap(e.target.value)}
            />
          </label>
          <Button size="sm" variant="secondary" state={addRoom.state} disabled={!roomName.trim()}>
            Add room
          </Button>
        </form>
      )}
    </section>
  );
}

function RoomCard({
  room,
  canManage,
  send,
}: {
  room: Room;
  canManage: boolean;
  send: (path: string, body?: unknown, method?: string) => Promise<unknown>;
}) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Boarder[]>([]);
  const [adding, setAdding] = useState(false);

  async function search(term: string) {
    setQ(term);
    if (term.trim().length < 1) {
      setMatches([]);
      return;
    }
    const res = await fetch(`/api/proxy/housing/candidates?q=${encodeURIComponent(term)}`);
    if (res.ok) setMatches(await res.json());
  }

  const full = room.occupied >= room.capacity;

  return (
    <div className="rounded-lg border border-mist/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{room.name}</p>
        <span className={`text-[11px] tabular ${full ? 'text-clay' : 'text-oat'}`}>
          {room.occupied}/{room.capacity} beds
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {room.boarders.map((b) => (
          <li key={b.studentId} className="flex items-center justify-between text-[13px]">
            <span>
              {b.name}
              {b.className ? <span className="text-oat"> · {b.className}</span> : null}
            </span>
            {canManage && (
              <ConfirmButton
                label="Remove"
                question="Remove from this bed?"
                confirmLabel="Remove"
                danger
                triggerClassName="text-[11px] text-clay hover:underline underline-offset-2"
                onConfirm={() => send(`/housing/boarders/${b.studentId}`, undefined, 'DELETE')}
              />
            )}
          </li>
        ))}
        {room.boarders.length === 0 && <li className="text-[12px] text-oat">Empty.</li>}
      </ul>

      {canManage &&
        !full &&
        (adding ? (
          <div className="mt-2">
            <input
              autoFocus
              className={`${field} block w-full text-[13px]`}
              placeholder="Search a pupil to give a bed…"
              value={q}
              onChange={(e) => search(e.target.value)}
            />
            {matches.length > 0 && (
              <ul className="mt-1 rounded-lg border border-mist bg-white shadow-sm max-h-40 overflow-auto">
                {matches.map((m) => (
                  <li key={m.studentId}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-parchment"
                      onClick={async () => {
                        await send(`/housing/rooms/${room.id}/assign`, { studentId: m.studentId });
                        setAdding(false);
                        setQ('');
                        setMatches([]);
                      }}
                    >
                      {m.name}
                      {m.className ? <span className="text-oat"> · {m.className}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 text-[12px] font-medium text-brand hover:underline underline-offset-2"
          >
            + Assign a boarder
          </button>
        ))}
    </div>
  );
}

function ExeatBook({
  exeats,
  boarders,
  canManage,
  send,
}: {
  exeats: Exeat[];
  boarders: { studentId: string; name: string; room: string }[];
  canManage: boolean;
  send: (path: string, body?: unknown, method?: string) => Promise<unknown>;
}) {
  const [studentId, setStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const [dueBack, setDueBack] = useState('');
  const signOut = useAsyncAction(async () => {
    await send('/housing/exeats', { studentId, reason, destination, dueBackAt: dueBack });
    setStudentId('');
    setReason('');
    setDestination('');
    setDueBack('');
  });

  const out = exeats.filter((e) => !e.returnedAt);
  const back = exeats.filter((e) => e.returnedAt);

  return (
    <section className="card p-5 mt-6">
      <h2 className="font-display text-lg">Exeat book</h2>
      <p className="text-[12px] text-oat mt-0.5">Who is signed out, and who is overdue back.</p>

      {canManage && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-b border-mist/50 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            signOut.run();
          }}
        >
          <div className="w-48">
            <Combobox
              label="Boarder"
              options={boarders.map((b) => ({ value: b.studentId, label: b.name, hint: b.room }))}
              value={studentId}
              onChange={setStudentId}
              placeholder="Search a boarder…"
            />
          </div>
          <label className="text-[12px] text-oat">
            Reason
            <input
              className={`${field} mt-1 block w-40`}
              placeholder="Weekend at home"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="text-[12px] text-oat">
            Destination
            <input
              className={`${field} mt-1 block w-36`}
              placeholder="Optional"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <label className="text-[12px] text-oat">
            Due back
            <input
              type="datetime-local"
              className={`${field} mt-1 block`}
              value={dueBack}
              onChange={(e) => setDueBack(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            state={signOut.state}
            disabled={!studentId || !reason.trim() || !dueBack}
          >
            Sign out
          </Button>
        </form>
      )}

      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wider text-oat">Currently out</p>
        <ul className="mt-2 space-y-2">
          {out.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{e.name}</span>{' '}
                <span className="text-oat">
                  — {e.reason}
                  {e.destination ? ` (${e.destination})` : ''} · due {fmt(e.dueBackAt)}
                </span>
                {e.overdue && (
                  <span className="ml-2 text-[11px] font-medium text-danger">OVERDUE</span>
                )}
              </span>
              {canManage && (
                <ConfirmButton
                  label="Sign in"
                  question={`Sign ${e.name} back in?`}
                  confirmLabel="Sign in"
                  triggerClassName="text-[12px] font-medium text-brand hover:underline underline-offset-2"
                  onConfirm={() => send(`/housing/exeats/${e.id}/return`)}
                />
              )}
            </li>
          ))}
          {out.length === 0 && <li className="text-[13px] text-oat">Everyone is in.</li>}
        </ul>
      </div>

      {back.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-oat">Recently returned</p>
          <ul className="mt-2 space-y-1 text-[13px] text-oat">
            {back.slice(0, 5).map((e) => (
              <li key={e.id}>
                {e.name} — {e.reason} · back {fmt(e.returnedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
