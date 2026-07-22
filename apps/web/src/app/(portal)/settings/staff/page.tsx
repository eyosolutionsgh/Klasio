'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Combobox from '@/components/Combobox';
import Pagination from '@/components/Pagination';
import SortHeader from '@/components/SortHeader';
import { Button, useAsyncAction } from '@/components/Button';
import { MailIcon, PhoneIcon, PlusIcon, SaveIcon, SearchIcon, UserIcon } from '@/components/icons';
import { DEFAULT_PER_PAGE, listHref, one, type ListSearchParams } from '@/lib/list';
import NoAccess from '@/components/NoAccess';
import RowMenu from '@/components/RowMenu';

/**
 * Staff accounts, and what each person may do.
 *
 * Two things govern access and they are not the same:
 *
 * - **The role** is the bundle of permissions the school defined on Roles & permissions. It is
 *   what decides what the person can reach, and it is the only thing this screen asks for.
 * - **Whether they are the proprietor.** The one distinction the account itself still carries:
 *   the proprietor holds everything, cannot be narrowed, and only a proprietor can make another.
 *
 * There used to be an "account type" as well — head teacher, bursar, teaching staff, administrative
 * staff — a second, coarser job title that granted nothing. It made schools describe the same
 * person twice, and the second description was often wrong: a system administrator had to be filed
 * as "front desk", because the list had no word for what they were.
 *
 * Per-person adjustments exist for exceptions, not as the ordinary way to grant access. A
 * revocation always wins over the role, so it is safe to take something away and it will not creep
 * back when the role changes.
 *
 * Every control here keys off `manageable`, which the API computes from the `users.manage`
 * permission the routes actually require. Showing a button the API will refuse teaches the user
 * nothing except that the app is unreliable.
 */

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
  staffRoleId: string | null;
  staffRole: { id: string; name: string } | null;
  extraPermissions: string[];
  revokedPermissions: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  presetKey: string | null;
  staffCount: number;
}

interface PermissionDef {
  code: string;
  label: string;
  group: string;
  caution?: string;
}

/**
 * Which columns the list may be ordered by, and how each compares.
 *
 * `GET /users` returns the whole staff of one school, so the searching, ordering and paging here
 * are done in the browser over rows that have already arrived — there is no second request to make
 * and no truncation to undo. The comparators still live behind a named allowlist so a stale or
 * hand-edited `?sort=` lands on the default order rather than on `undefined` being compared.
 *
 * Names are compared with `localeCompare` because the register is full of names outside ASCII —
 * Ashiokai, Owusu-Ansah, Ọláwálé — and a plain `<` orders those by code point, which puts them in
 * an order no Ghanaian reader would call alphabetical.
 */
const STAFF_SORTS: Record<string, (a: StaffUser, b: StaffUser) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  email: (a, b) => a.email.localeCompare(b.email),
  // An account with no role sorts as an empty string, which lands the "cannot do anything"
  // accounts together at one end — where somebody auditing access wants to find them.
  staffRole: (a, b) => (a.staffRole?.name ?? '').localeCompare(b.staffRole?.name ?? ''),
  status: (a, b) => Number(b.active) - Number(a.active),
};

/** The order the API itself returns: everyone still working, alphabetically, then the leavers. */
const defaultOrder = (a: StaffUser, b: StaffUser) =>
  Number(b.active) - Number(a.active) || a.name.localeCompare(b.name);

const STATUSES = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Deactivated only' },
  { value: 'all', label: 'Everyone' },
];

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function StaffPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * The filters live in the URL rather than in component state so this page behaves like every
   * other list in the portal: a filtered view can be linked to a colleague, and the back button
   * steps back through the filters instead of leaving the page entirely.
   */
  const params = useMemo(
    () => Object.fromEntries(searchParams.entries()) as ListSearchParams,
    [searchParams],
  );
  const q = one(params.q) ?? '';
  const roleFilter = one(params.role) ?? '';
  const status = one(params.status) ?? 'active';
  const sort = one(params.sort);
  const order = one(params.order) === 'desc' ? 'desc' : 'asc';
  const perPage = Math.max(Number(one(params.perPage)) || DEFAULT_PER_PAGE, 1);
  const page = Math.max(Number(one(params.page)) || 1, 1);
  const includeInactive = status !== 'active';

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [held, setHeld] = useState<string[]>([]);
  /** `GET /roles/mine` reports the caller's own account type; only a proprietor may make one. */
  const [isProprietor, setIsProprietor] = useState(false);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Shown once, never retrievable again — the API only ever returns it on create/reset. */
  const [credential, setCredential] = useState<{
    email: string;
    password: string;
    /** True when this had to be shown because the reset could not be delivered to its owner. */
    undelivered?: boolean;
  } | null>(null);
  const [sentTo, setSentTo] = useState<{ name: string; where: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffRoleId, setStaffRoleId] = useState('');

  /**
   * A refusal is a state, not a missing result.
   *
   * `if (res.ok)` alone left a 403 looking exactly like a school with no staff — the screen
   * rendered in full and announced "No staff accounts yet" to someone who simply may not see it.
   */
  const [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/users?includeInactive=${includeInactive}`);
    if (res.ok) {
      setUsers(await res.json());
      setDenied(false);
    } else if (res.status === 403) {
      setDenied(true);
    }
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const [rolesRes, mineRes] = await Promise.all([
        fetch('/api/proxy/roles'),
        fetch('/api/proxy/roles/mine'),
      ]);
      if (rolesRes.ok) setRoles(await rolesRes.json());
      const mine = mineRes.ok ? await mineRes.json() : { permissions: [] };
      const mineHeld: string[] = mine.permissions ?? [];
      setHeld(mineHeld);
      setIsProprietor(mine.role === 'OWNER');
      // Permission labels live behind roles.manage. Without it the per-person adjustments are
      // hidden rather than shown as bare codes.
      if (mineHeld.includes('roles.manage')) {
        const cat = await fetch('/api/proxy/roles/catalogue');
        if (cat.ok) setPermissions((await cat.json()).permissions ?? []);
      }
    })();
  }, []);

  /**
   * Only roles wholly within the caller's own authority — unless administering access is the job.
   *
   * The API refuses the rest ("includes access you do not have yourself"), so offering them would
   * be offering a button that always fails. `users.delegate` lifts that on both sides: a system
   * administrator exists to put people on roles they could not do themselves, and hiding those
   * roles here left them looking at "12 roles are not listed" and no way to staff the bursar's
   * desk — the exact job they were employed for.
   */
  const delegates = held.includes('users.delegate');
  const grantable = useMemo(
    () => (delegates ? roles : roles.filter((r) => r.permissions.every((p) => held.includes(p)))),
    [roles, held, delegates],
  );
  const hiddenRoles = roles.length - grantable.length;
  const roleOptions = useMemo(
    () =>
      grantable.map((r) => ({
        value: r.id,
        label: r.name,
        hint: r.description ?? undefined,
      })),
    [grantable],
  );
  const grantablePermissions = useMemo(
    () => (delegates ? permissions : permissions.filter((p) => held.includes(p.code))),
    [permissions, held, delegates],
  );

  /**
   * Deactivated accounts are filtered here as well as by the request.
   *
   * `?includeInactive=true` widens the query to everybody; narrowing to "deactivated only" is this
   * screen's own question and has no server equivalent, so both ends of the choice are applied
   * against what came back rather than only one of them being honoured.
   */
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (status === 'inactive' && u.active) return false;
      if (roleFilter && u.staffRoleId !== roleFilter) return false;
      if (!needle) return true;
      return (
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        (u.phone ?? '').toLowerCase().includes(needle)
      );
    });
  }, [users, q, roleFilter, status]);

  const sorted = useMemo(() => {
    const cmp = sort ? STAFF_SORTS[sort] : undefined;
    if (!cmp) return [...matching].sort(defaultOrder);
    const dir = order === 'desc' ? -1 : 1;
    // The name is the tie-break on every column, so re-sorting by account type does not shuffle
    // the people within a type on each render.
    return [...matching].sort((a, b) => cmp(a, b) * dir || a.name.localeCompare(b.name));
  }, [matching, sort, order]);

  const pageCount = Math.max(Math.ceil(sorted.length / perPage), 1);
  // A filter that shortens the list can strand the reader on a page that no longer exists; showing
  // the last page there is kinder than an empty table that reads as "nobody matched".
  const current = Math.min(page, pageCount);
  const shown = sorted.slice((current - 1) * perPage, current * perPage);

  const go = (changes: Record<string, string | undefined>) =>
    router.push(listHref('/settings/staff', params, changes));

  const editingUser = editing ? (users.find((u) => u.id === editing) ?? null) : null;

  async function send(path: string, body?: unknown, method = 'POST') {
    setError(null);
    const res = await fetch(`/api/proxy/users${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        Array.isArray(data.message)
          ? data.message.join('. ')
          : (data.message ?? 'That did not work.'),
      );
      return null;
    }
    load();
    return data;
  }

  const addStaff = useAsyncAction(async () => {
    const data = await send('', {
      name,
      email,
      phone: phone || undefined,
      ...(staffRoleId ? { staffRoleId } : {}),
    });
    // `send` has already put the server's reason in `error`; throwing is what settles the button
    // on "Couldn't add" rather than a tick for an account that was never created.
    if (!data) throw new Error('add rejected');
    setName('');
    setEmail('');
    setPhone('');
    setStaffRoleId('');
    if (data.temporaryPassword) {
      setCredential({ email: data.email, password: data.temporaryPassword });
    }
  });

  /**
   * A reset now goes to the person, not to whoever pressed the button.
   *
   * The account is cut off immediately — old password dead, every session ended — and its owner
   * is emailed a link to choose a new one. An administrator who never sees a credential cannot
   * sign in as the bursar, which is what keeps handing out access separate from having it.
   *
   * The password only comes back here when delivery could not happen at all (a LAN box with no
   * mail credentials), and then it is shown as the hand-over of last resort that it is.
   */
  async function resetPassword(u: StaffUser) {
    const d = await send(`/${u.id}/reset-password`, {});
    if (!d) throw new Error('reset rejected');
    if (d.temporaryPassword) {
      setCredential({ email: d.email, password: d.temporaryPassword, undelivered: true });
    } else {
      setSentTo({ name: u.name, where: d.sentTo ?? d.email });
    }
  }

  async function makeProprietor(u: StaffUser) {
    const d = await send(`/${u.id}`, { role: 'OWNER' }, 'PATCH');
    if (!d) throw new Error('promotion rejected');
  }

  async function toggleActive(u: StaffUser) {
    const d = await send(`/${u.id}`, { active: !u.active }, 'PATCH');
    if (!d) throw new Error('toggle rejected');
  }

  /** "1 added, 2 taken away" — silent when the person is simply on their role. */
  const adjustmentNote = (u: StaffUser) => {
    const parts = [
      u.extraPermissions.length > 0 ? `${u.extraPermissions.length} added` : null,
      u.revokedPermissions.length > 0 ? `${u.revokedPermissions.length} taken away` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  if (denied) return <NoAccess what="staff accounts" />;

  return (
    <div>
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Staff accounts</h1>
          <p className="text-sm text-oat mt-1.5">
            Who can sign in, and what each person may do. A staff role decides the access — the
            bundles themselves are edited on{' '}
            <a href="/settings/roles" className="text-brand hover:underline underline-offset-2">
              Roles &amp; permissions
            </a>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Role</span>
            <select
              value={roleFilter}
              onChange={(e) => go({ role: e.target.value || undefined })}
              className={field}
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="block text-oat mb-1">Status</span>
            <select
              value={status}
              onChange={(e) => go({ status: e.target.value })}
              className={field}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {/* Uncontrolled and submitted, not filtered per keystroke: every character would
              otherwise push a history entry, and the back button would walk the search backwards
              one letter at a time. */}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const typed = String(new FormData(e.currentTarget).get('q') ?? '').trim();
              go({ q: typed || undefined });
            }}
          >
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Search</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <SearchIcon />
                </span>
                <input
                  key={q}
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Name, email or phone"
                  className={`${field} w-52 pl-10`}
                />
              </div>
            </label>
            <Button type="submit">Search</Button>
          </form>
        </div>
      </div>

      {sentTo && (
        <div className="card p-5 mt-5 border-gold/50 rise">
          <p className="text-sm font-medium">
            {sentTo.name} has been signed out everywhere, and sent a link to choose a new password
          </p>
          <p className="text-xs text-oat mt-1">
            Sent to {sentTo.where}. The link expires shortly and can be used once. Their old
            password no longer works — nobody, including you, holds the new one.
          </p>
          <button
            onClick={() => setSentTo(null)}
            className="mt-3 text-[12px] text-oat hover:text-brand transition underline underline-offset-2"
          >
            Done
          </button>
        </div>
      )}

      {credential && (
        <div className="card p-5 mt-5 border-gold/50 rise">
          <p className="text-sm font-medium">
            {credential.undelivered
              ? 'Could not send it — hand this over in person'
              : 'Temporary password — shown once'}
          </p>
          <p className="text-xs text-oat mt-1">
            {credential.undelivered
              ? `This box could not reach ${credential.email}, so the password is shown here instead. Give it to them directly and have them change it.`
              : `Give this to ${credential.email}. It is stored encrypted and cannot be shown again; issue a new one if it is lost.`}
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
      {error && <p className="text-sm text-danger mt-4">{error}</p>}

      <div className="card mt-6 overflow-x-auto rise rise-2 table-stack-wrap">
        <table className="w-full text-sm sm:min-w-[720px] table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <SortHeader column="name" base="/settings/staff" params={params}>
                Name
              </SortHeader>
              <SortHeader column="email" base="/settings/staff" params={params}>
                Email
              </SortHeader>
              <SortHeader column="staffRole" base="/settings/staff" params={params}>
                Role
              </SortHeader>
              <SortHeader column="status" base="/settings/staff" params={params}>
                Status
              </SortHeader>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="border-b border-mist/60 last:border-0">
                <td data-label="Name" className="px-5 py-3 font-medium">
                  {u.name}
                  {u.isSelf && <span className="ml-2 text-[11px] text-oat">(you)</span>}
                </td>
                <td data-label="Email" className="px-5 py-3 text-oat">
                  {u.email}
                  {u.phone && <span className="block text-[11px] tabular">{u.phone}</span>}
                </td>
                <td data-label="Role" className="px-5 py-3">
                  {u.role === 'OWNER' ? (
                    <>
                      <span className="font-medium">Proprietor — full access</span>
                      <span className="block text-[11px] text-oat">
                        The proprietor always reaches everything. It cannot be narrowed.
                      </span>
                    </>
                  ) : (
                    <>
                      {u.staffRole ? (
                        <span>{u.staffRole.name}</span>
                      ) : (
                        // Not an error state: an account with no role can sign in and do nothing,
                        // which is a legitimate way to suspend someone.
                        <span className="text-oat">No role — cannot do anything</span>
                      )}
                      {adjustmentNote(u) && (
                        <span className="block text-[11px] text-clay">{adjustmentNote(u)}</span>
                      )}
                    </>
                  )}
                </td>
                <td data-label="Status" className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${u.active ? 'bg-brand-mist text-brand' : 'bg-parchment text-oat'}`}
                  >
                    {u.active ? 'active' : 'deactivated'}
                  </span>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-end">
                    <RowMenu
                      label={u.name}
                      actions={[
                        {
                          label: editing === u.id ? 'Close access panel' : 'Adjust access',
                          hidden: u.role === 'OWNER' || !u.manageable,
                          onSelect: () => setEditing(editing === u.id ? null : u.id),
                        },
                        {
                          label: 'Reset password',
                          hidden: !u.manageable,
                          confirm: `Reset ${u.name}'s password? They are signed out everywhere and sent a link to choose a new one — you will not see it.`,
                          confirmLabel: 'Yes, reset it',
                          pendingLabel: 'Resetting…',
                          doneLabel: 'Password reset',
                          failedLabel: "Couldn't reset",
                          onSelect: () => resetPassword(u),
                        },
                        {
                          label: 'Make proprietor',
                          hidden: !isProprietor || !u.manageable || u.role === 'OWNER',
                          confirm: `Make ${u.name} a proprietor? They would hold every permission in the school, permanently — nobody could narrow it afterwards, including you.`,
                          confirmLabel: 'Yes, make proprietor',
                          pendingLabel: 'Making…',
                          doneLabel: 'Now a proprietor',
                          onSelect: () => makeProprietor(u),
                        },
                        {
                          label: u.active ? 'Deactivate' : 'Reactivate',
                          hidden: !u.manageable,
                          danger: u.active,
                          confirm: u.active
                            ? `Deactivate ${u.name}? They can no longer sign in. Their records stay.`
                            : undefined,
                          pendingLabel: u.active ? 'Deactivating…' : 'Reactivating…',
                          doneLabel: u.active ? 'Deactivated' : 'Reactivated',
                          onSelect: () => toggleActive(u),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  {users.length === 0
                    ? 'No staff accounts yet.'
                    : 'No accounts match. Try a different role, status or search term.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={{ total: sorted.length, page: current, perPage, pageCount }}
          base="/settings/staff"
          params={params}
          label="staff accounts"
        />
      </div>

      {/*
        Looked up in the whole list, not the visible page, and guarded rather than asserted: paging
        or filtering while a panel is open would otherwise leave `editing` pointing at somebody who
        is no longer rendered, and a non-null assertion there crashes the screen.
      */}
      {editingUser && (
        <AccessPanel
          key={editing}
          user={editingUser}
          roleOptions={roleOptions}
          hiddenRoles={hiddenRoles}
          permissions={grantablePermissions}
          allPermissions={permissions}
          onCancel={() => setEditing(null)}
          onSave={async (body) => {
            setError(null);
            const res = await fetch(`/api/proxy/roles/assign/${editing}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(
                Array.isArray(data.message)
                  ? data.message.join('. ')
                  : (data.message ?? 'That did not work.'),
              );
              // Thrown so the panel's button settles on "Couldn't save" — the reason is above.
              throw new Error('assign rejected');
            }
            // The list is the source of truth, so re-read it rather than mirroring the write.
            await load();
            setEditing(null);
          }}
        />
      )}

      {/* Hidden without users.manage: POST /users would refuse it, and a form that always fails
          is worse than no form. */}
      {held.includes('users.manage') && (
        <form onSubmit={addStaff.run} className="card p-6 mt-6 rise rise-3 max-w-3xl">
          <h2 className="font-display text-xl">Add a staff member</h2>
          <p className="text-xs text-oat mt-1">
            A temporary password is generated and shown once — hand it over and ask them to change
            it. Give them a staff role now: without one the account can sign in and do nothing.
          </p>
          {/* Each field grows to share the row rather than sitting at a fixed width: a full
              Ghanaian name and a school address both ran out of room and scrolled inside their
              own box. They wrap onto a second row before they shrink below a readable width. */}
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <label className="text-[13px] flex-1 min-w-[14rem]">
              <span className="block text-oat mb-1">Full name</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <UserIcon />
                </span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ms. Efua Sarpong"
                  className={`${field} w-full pl-10`}
                />
              </div>
            </label>
            <label className="text-[13px] flex-1 min-w-[15rem]">
              <span className="block text-oat mb-1">Email</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <MailIcon />
                </span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="efua@school.gh"
                  className={`${field} w-full pl-10`}
                />
              </div>
            </label>
            <label className="text-[13px] flex-1 min-w-[11rem]">
              <span className="block text-oat mb-1">Phone</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <PhoneIcon />
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="024 123 4567"
                  className={`${field} w-full pl-10`}
                />
              </div>
            </label>
            {/* No account type is asked for. The job below is the answer, and it is the one the
                API enforces; a proprietor is made deliberately from the row menu instead. */}
            <Combobox
              label="Role"
              className="flex-1 min-w-[14rem]"
              options={roleOptions}
              value={staffRoleId}
              onChange={setStaffRoleId}
              clearLabel="— no role yet —"
              placeholder="Search roles…"
            />
            <Button type="submit" state={addStaff.state} icon={<PlusIcon />}>
              Add staff
            </Button>
          </div>
          {hiddenRoles > 0 && (
            <p className="text-[11px] text-oat mt-3">
              {hiddenRoles} {hiddenRoles === 1 ? 'role is' : 'roles are'} not listed because{' '}
              {hiddenRoles === 1 ? 'it includes' : 'they include'} access you do not hold yourself.
              You cannot put someone on a role you could not do yourself.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function AccessPanel({
  user,
  roleOptions,
  hiddenRoles,
  permissions,
  allPermissions,
  onCancel,
  onSave,
}: {
  user: StaffUser;
  roleOptions: { value: string; label: string; hint?: string }[];
  hiddenRoles: number;
  /** Only what the caller may hand on — the API refuses the rest. */
  permissions: PermissionDef[];
  /** Everything, for revocations: taking access away is never restricted. */
  allPermissions: PermissionDef[];
  onCancel: () => void;
  onSave: (body: {
    staffRoleId?: string | null;
    extraPermissions?: string[];
    revokedPermissions?: string[];
  }) => Promise<void>;
}) {
  // Seeded from what the person actually holds, so saving edits the current state rather than
  // replacing it with whatever happens to be typed in.
  const [staffRoleId, setStaffRoleId] = useState(user.staffRoleId ?? '');
  const [extra, setExtra] = useState<string[]>(user.extraPermissions);
  const [revoked, setRevoked] = useState<string[]>(user.revokedPermissions);

  const save = useAsyncAction(() =>
    onSave({
      staffRoleId: staffRoleId || null,
      extraPermissions: extra,
      revokedPermissions: revoked,
    }),
  );

  const labelOf = (code: string) => allPermissions.find((p) => p.code === code)?.label ?? code;

  const opts = (defs: PermissionDef[], exclude: string[]) =>
    defs
      .filter((p) => !exclude.includes(p.code))
      .map((p) => ({ value: p.code, label: p.label, hint: p.group }));

  return (
    <section className="card p-6 mt-4 rise">
      <h2 className="font-display text-xl">{user.name}&rsquo;s access</h2>
      <p className="text-xs text-oat mt-1">
        The role does the work. The two lists below are for the exception — the one teacher who also
        covers the gate — not the normal way to give somebody access. If several people need the
        same thing, make a role for it instead.
      </p>

      <div className="mt-5 max-w-sm">
        <Combobox
          label="Staff role"
          options={roleOptions}
          value={staffRoleId}
          onChange={setStaffRoleId}
          clearLabel="— no role —"
          placeholder="Search roles…"
        />
        <p className="text-[11px] text-oat mt-1.5">
          With no role the account can sign in and do nothing — a way to suspend access without
          deactivating the person.
          {hiddenRoles > 0 &&
            ` ${hiddenRoles} ${hiddenRoles === 1 ? 'role is' : 'roles are'} not listed: ${hiddenRoles === 1 ? 'it includes' : 'they include'} access you do not hold.`}
        </p>
      </div>

      {allPermissions.length === 0 ? (
        <p className="text-xs text-oat mt-5 border-l-2 border-gold pl-3">
          Per-person adjustments need the &ldquo;Create and edit roles&rdquo; permission, because
          they are a change to what one person may do. You can still put this person on a role.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 mt-6">
          <div>
            <h3 className="text-sm font-medium">Also allow</h3>
            <p className="text-[11px] text-oat mt-0.5 mb-2">
              On top of the role. Only access you hold yourself is listed.
            </p>
            <Combobox
              label="Add"
              options={opts(permissions, extra)}
              value=""
              onChange={(v) => v && setExtra([...extra, v])}
              clearLabel="Choose one…"
              placeholder="Search permissions…"
            />
            <ul className="mt-3 space-y-1.5">
              {extra.map((code) => (
                <li key={code} className="flex items-start gap-2 text-[13px]">
                  <span className="flex-1">{labelOf(code)}</span>
                  <button
                    type="button"
                    onClick={() => setExtra(extra.filter((c) => c !== code))}
                    className="text-[12px] text-clay hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {extra.length === 0 && <li className="text-xs text-oat">Nothing extra.</li>}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium">Never allow</h3>
            <p className="text-[11px] text-oat mt-0.5 mb-2">
              A revocation always wins. If the role grants it and it is listed here, this person
              still cannot do it — and it will not creep back when the role changes.
            </p>
            <Combobox
              label="Add"
              options={opts(allPermissions, revoked)}
              value=""
              onChange={(v) => v && setRevoked([...revoked, v])}
              clearLabel="Choose one…"
              placeholder="Search permissions…"
            />
            <ul className="mt-3 space-y-1.5">
              {revoked.map((code) => (
                <li key={code} className="flex items-start gap-2 text-[13px]">
                  <span className="flex-1">{labelOf(code)}</span>
                  <button
                    type="button"
                    onClick={() => setRevoked(revoked.filter((c) => c !== code))}
                    className="text-[12px] text-clay hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {revoked.length === 0 && <li className="text-xs text-oat">Nothing taken away.</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-mist/60">
        <Button type="button" state={save.state} onClick={save.run} icon={<SaveIcon />}>
          Save access
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] text-oat hover:text-brand transition"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
