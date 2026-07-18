'use client';

import { useCallback, useEffect, useState } from 'react';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  active: boolean;
  manageable: boolean;
  isSelf: boolean;
  createdAt: string;
}

const ROLES = ['OWNER', 'HEAD', 'BURSAR', 'TEACHER', 'FRONT_DESK'];
const label = (r: string) => r.toLowerCase().replace('_', ' ');

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown once, never retrievable again — the API only ever returns it on create/reset. */
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('TEACHER');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/users?includeInactive=${includeInactive}`);
    if (res.ok) setUsers(await res.json());
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setMessage(null);
    setError(null);
    const res = await fetch(`/api/proxy/users${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'That did not work.');
      return null;
    }
    load();
    return data;
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const data = await send('', {
      name,
      email,
      role,
      phone: phone || undefined,
    });
    setBusy(false);
    if (data) {
      setName('');
      setEmail('');
      setPhone('');
      if (data.temporaryPassword) {
        setCredential({ email: data.email, password: data.temporaryPassword });
      }
      setMessage(`${data.name} can now sign in.`);
    }
  }

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Staff &amp; access</h1>
          <p className="text-sm text-oat mt-1.5">
            Who can sign in, and what each person may do. Roles decide access — a teacher sees marks
            and attendance, a bursar sees money.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-oat">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      {credential && (
        <div className="card p-5 mt-5 border-gold/50 rise">
          <p className="text-sm font-medium">Temporary password — shown once</p>
          <p className="text-xs text-oat mt-1">
            Give this to {credential.email}. It is stored encrypted and cannot be shown again; issue
            a new one if it is lost.
          </p>
          <p className="font-display text-2xl tabular mt-3 select-all">{credential.password}</p>
          <button
            onClick={() => setCredential(null)}
            className="mt-3 text-[12px] text-oat hover:text-brand transition underline underline-offset-2"
          >
            I have copied it
          </button>
        </div>
      )}
      {message && <p className="text-sm text-brand mt-4">{message}</p>}
      {error && <p className="text-sm text-danger mt-4">{error}</p>}

      <div className="card mt-6 overflow-x-auto rise rise-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-mist/60 last:border-0">
                <td className="px-5 py-3 font-medium">
                  {u.name}
                  {u.isSelf && <span className="ml-2 text-[11px] text-oat">(you)</span>}
                </td>
                <td className="px-5 py-3 text-oat">
                  {u.email}
                  {u.phone && <span className="block text-[11px] tabular">{u.phone}</span>}
                </td>
                <td className="px-5 py-3">
                  {u.manageable ? (
                    <select
                      value={u.role}
                      onChange={(e) => send(`/${u.id}`, { role: e.target.value }, 'PATCH')}
                      className={`${field} py-1`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="capitalize">{label(u.role)}</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${u.active ? 'bg-brand-mist text-brand' : 'bg-parchment text-oat'}`}
                  >
                    {u.active ? 'active' : 'deactivated'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  {u.manageable && (
                    <>
                      <button
                        onClick={async () => {
                          const d = await send(`/${u.id}/reset-password`, {});
                          if (d?.temporaryPassword)
                            setCredential({ email: d.email, password: d.temporaryPassword });
                        }}
                        className="text-[12.5px] text-brand hover:underline underline-offset-2 mr-3"
                      >
                        Reset password
                      </button>
                      <button
                        onClick={() => send(`/${u.id}`, { active: !u.active }, 'PATCH')}
                        className={`text-[12.5px] hover:underline underline-offset-2 ${u.active ? 'text-clay' : 'text-brand'}`}
                      >
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={addStaff} className="card p-6 mt-6 rise rise-3 max-w-2xl">
        <h2 className="font-display text-xl">Add a staff member</h2>
        <p className="text-xs text-oat mt-1">
          A temporary password is generated and shown once — hand it over and ask them to change it.
        </p>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Full name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ms. Efua Sarpong"
              className={`${field} w-52`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="efua@school.gh"
              className={`${field} w-56`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Phone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 123 4567"
              className={`${field} w-36`}
            />
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2 hover:bg-brand-deep transition disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add staff'}
          </button>
        </div>
      </form>
    </div>
  );
}
