'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Combobox from '@/components/Combobox';
import { Button, useAsyncAction } from '@/components/Button';
import { KeyIcon, MailIcon, PhoneIcon, PlusIcon, SaveIcon, UserIcon } from '@/components/icons';
import { roleLabel } from '@/lib/roles';

/**
 * Staff accounts, and what each person may do.
 *
 * Two things govern access and they are not the same:
 *
 * - **Account type** (proprietor, head teacher, bursar, teaching staff, administrative staff) is the coarse legacy role. It still
 *   decides who may manage whose account, and the proprietor's is special.
 * - **The staff role** is the bundle of permissions the school defined on Roles & permissions. That is
 *   what actually decides what the person can reach.
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

const ROLES = ['OWNER', 'HEAD', 'BURSAR', 'TEACHER', 'FRONT_DESK'];
const label = roleLabel;

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [held, setHeld] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shown once, never retrievable again — the API only ever returns it on create/reset. */
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('TEACHER');
  const [staffRoleId, setStaffRoleId] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/proxy/users?includeInactive=${includeInactive}`);
    if (res.ok) setUsers(await res.json());
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
      // Permission labels live behind roles.manage. Without it the per-person adjustments are
      // hidden rather than shown as bare codes.
      if (mineHeld.includes('roles.manage')) {
        const cat = await fetch('/api/proxy/roles/catalogue');
        if (cat.ok) setPermissions((await cat.json()).permissions ?? []);
      }
    })();
  }, []);

  /**
   * Only roles wholly within the caller's own authority.
   *
   * The API refuses the rest ("includes access you do not have yourself"), so offering them would
   * be offering a button that always fails.
   */
  const grantable = useMemo(
    () => roles.filter((r) => r.permissions.every((p) => held.includes(p))),
    [roles, held],
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
    () => permissions.filter((p) => held.includes(p.code)),
    [permissions, held],
  );

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
      role,
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

  /** The temporary password is the whole point of the reset, so it goes straight to the card. */
  async function resetPassword(u: StaffUser) {
    const d = await send(`/${u.id}/reset-password`, {});
    if (!d) throw new Error('reset rejected');
    if (d.temporaryPassword) setCredential({ email: d.email, password: d.temporaryPassword });
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
      {error && <p className="text-sm text-danger mt-4">{error}</p>}

      <div className="card mt-6 overflow-x-auto rise rise-2">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Account type</th>
              <th className="px-5 py-3 font-medium">Staff role</th>
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
                    <span>{label(u.role)}</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {u.role === 'OWNER' ? (
                    <>
                      <span className="font-medium">Full access</span>
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
                <td className="px-5 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-0.5 ${u.active ? 'bg-brand-mist text-brand' : 'bg-parchment text-oat'}`}
                  >
                    {u.active ? 'active' : 'deactivated'}
                  </span>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {u.role !== 'OWNER' && u.manageable && (
                      // A local panel toggle, not a request — it keeps its link treatment.
                      <button
                        onClick={() => setEditing(editing === u.id ? null : u.id)}
                        className="text-[12.5px] text-brand hover:underline underline-offset-2 mr-1"
                      >
                        {editing === u.id ? 'Close' : 'Access'}
                      </button>
                    )}
                    {u.manageable && (
                      <RowActions user={u} onReset={resetPassword} onToggleActive={toggleActive} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-oat">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccessPanel
          key={editing}
          user={users.find((u) => u.id === editing)!}
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
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <label className="text-[13px]">
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
                  className={`${field} w-52 pl-10`}
                />
              </div>
            </label>
            <label className="text-[13px]">
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
                  className={`${field} w-56 pl-10`}
                />
              </div>
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Phone</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                  <PhoneIcon />
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="024 123 4567"
                  className={`${field} w-36 pl-10`}
                />
              </div>
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Account type</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </label>
            <Combobox
              label="Staff role"
              className="w-56"
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

/**
 * The two per-row requests.
 *
 * Its own component because each row needs its own pending/done state, and hooks cannot be called
 * inside the map that renders the table.
 */
function RowActions({
  user,
  onReset,
  onToggleActive,
}: {
  user: StaffUser;
  onReset: (u: StaffUser) => Promise<void>;
  onToggleActive: (u: StaffUser) => Promise<void>;
}) {
  const reset = useAsyncAction(() => onReset(user));
  const toggle = useAsyncAction(() => onToggleActive(user));

  return (
    <>
      {/* "Reset" is not one of the conjugated verbs, so the wording is spelled out. */}
      <Button
        size="sm"
        variant="secondary"
        state={reset.state}
        onClick={reset.run}
        icon={<KeyIcon />}
        pendingLabel="Resetting…"
        doneLabel="Password reset"
        failedLabel="Couldn't reset"
      >
        Reset password
      </Button>
      <Button
        size="sm"
        variant={user.active ? 'danger' : 'secondary'}
        state={toggle.state}
        onClick={toggle.run}
        pendingLabel={user.active ? 'Deactivating…' : 'Reactivating…'}
        doneLabel={user.active ? 'Deactivated' : 'Reactivated'}
      >
        {user.active ? 'Deactivate' : 'Reactivate'}
      </Button>
    </>
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
