'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, useAsyncAction, type ActionState } from '@/components/Button';
import { EditIcon, PlusIcon, RefreshIcon, SaveIcon, TrashIcon } from '@/components/icons';

/**
 * Roles, as the school defines them.
 *
 * Two rules from the API are visible in this screen rather than left to be discovered by a 403:
 *
 * - **You cannot hand out authority you do not hold.** `GET /roles/mine` says what the person
 *   editing holds; anything else is shown, disabled, with the reason. Letting someone tick it and
 *   then rejecting the save teaches them nothing about why.
 * - **Removal is always allowed.** A head who does not hold `fees.record_payment` must still be
 *   able to take it out of a role, or a role can never be narrowed by anyone but the proprietor.
 *   So a permission already in the role stays tickable-off even when it is not theirs to give.
 */

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

interface Catalogue {
  permissions: PermissionDef[];
  groups: string[];
}

interface Draft {
  /** Null while creating. */
  id: string | null;
  name: string;
  description: string;
  permissions: string[];
}

const field =
  'rounded-lg border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const blank: Draft = { id: null, name: '', description: '', permissions: [] };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Only the restore counts a result worth saying in prose ("Put back 3 roles", or that there was
  // nothing to put back). Every other outcome is now on the button that caused it.
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = held.includes('roles.manage');

  const load = useCallback(async () => {
    const [mineRes, rolesRes] = await Promise.all([
      fetch('/api/proxy/roles/mine'),
      fetch('/api/proxy/roles'),
    ]);
    const mine = mineRes.ok ? await mineRes.json() : { permissions: [] };
    const mineHeld: string[] = mine.permissions ?? [];
    setHeld(mineHeld);
    setRoles(rolesRes.ok ? await rolesRes.json() : []);
    // The catalogue is behind roles.manage. Asking for it without that permission would only
    // produce a 403 to swallow, so it is not asked for.
    if (mineHeld.includes('roles.manage')) {
      const cat = await fetch('/api/proxy/roles/catalogue');
      if (cat.ok) setCatalogue(await cat.json());
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byCode = useMemo(() => {
    const map = new Map<string, PermissionDef>();
    for (const p of catalogue?.permissions ?? []) map.set(p.code, p);
    return map;
  }, [catalogue]);

  async function send(path: string, body?: unknown, method = 'POST') {
    setMessage(null);
    setError(null);
    const res = await fetch(`/api/proxy/roles${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The API's refusals are written for a head teacher — "3 people hold this role. Move them
      // to another role first." Replacing that with a generic failure would lose the instruction.
      setError(
        Array.isArray(data.message)
          ? data.message.join('. ')
          : (data.message ?? 'That did not work.'),
      );
      return null;
    }
    await load();
    return data;
  }

  /** "Students 8 · Finance 3" — what a role is for, without forty codes. */
  const summary = (role: Role) => {
    const counts = new Map<string, number>();
    for (const code of role.permissions) {
      const group = byCode.get(code)?.group;
      if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return (catalogue?.groups ?? [])
      .filter((g) => counts.has(g))
      .map((g) => ({ group: g, count: counts.get(g)! }));
  };

  const save = useAsyncAction(async () => {
    if (!draft) return;
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      permissions: draft.permissions,
    };
    const ok = draft.id ? await send(`/${draft.id}`, body, 'PATCH') : await send('', body);
    // A refusal has to throw, or the button ticks for a role that was never written.
    if (!ok) throw new Error('rejected');
    setDraft(null);
  });

  const restorePresets = useAsyncAction(async () => {
    const d = await send('/restore-presets', {});
    if (!d) throw new Error('rejected');
    setMessage(
      d.restored > 0
        ? `Put back ${d.restored} ${d.restored === 1 ? 'role' : 'roles'}.`
        : 'Nothing to put back — you already have all the standard roles.',
    );
  });

  return (
    <div className="space-y-8">
      <div className="rise rise-1 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Roles &amp; permissions</h1>
          <p className="text-sm text-oat mt-1.5">
            A role is a named bundle of what a job may do. Give each person the least their work
            needs — it is far easier to add one thing later than to discover months on that everyone
            could see everything.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              icon={<PlusIcon />}
              onClick={() => {
                setDraft(blank);
                setMessage(null);
                setError(null);
              }}
            >
              New role
            </Button>
            {/* "Restore" is not a verb the label deriver knows, so the wording is given here. */}
            <Button
              variant="secondary"
              icon={<RefreshIcon />}
              state={restorePresets.state}
              onClick={restorePresets.run}
              pendingLabel="Restoring…"
              doneLabel="Restored!"
              failedLabel="Couldn't restore"
            >
              Restore standard roles
            </Button>
          </div>
        )}
      </div>

      {message && <p className="text-sm text-brand">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {loaded && !canManage && (
        <div className="card p-5 rise rise-2 border-gold/50">
          <p className="text-sm font-medium">You can see the roles, but not change them</p>
          <p className="text-xs text-oat mt-1">
            Editing roles changes what every holder of a role can do, so it needs the &ldquo;Create
            and edit roles&rdquo; permission. Ask the proprietor, or whoever manages accounts, if
            you need it. What each role includes is only shown to someone who can change it.
          </p>
        </div>
      )}

      {draft && catalogue && (
        <RoleEditor
          draft={draft}
          setDraft={setDraft}
          catalogue={catalogue}
          held={held}
          original={roles.find((r) => r.id === draft.id)?.permissions ?? []}
          onSubmit={save.run}
          state={save.state}
        />
      )}

      <section className="card rise rise-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">What it covers</th>
              <th className="px-5 py-3 font-medium text-right">Staff</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-mist/60 last:border-0 align-top">
                <td className="px-5 py-3">
                  <p className="font-medium">{r.name}</p>
                  {r.description && <p className="text-xs text-oat mt-0.5">{r.description}</p>}
                </td>
                <td className="px-5 py-3 text-xs text-oat">
                  {canManage ? (
                    <>
                      {summary(r).length === 0 && 'Nothing yet'}
                      {summary(r).map((s) => (
                        <span key={s.group} className="inline-block mr-3 whitespace-nowrap">
                          {s.group} <span className="tabular font-medium text-ink">{s.count}</span>
                        </span>
                      ))}
                      <span className="block mt-1 text-[11px]">
                        {r.permissions.length}{' '}
                        {r.permissions.length === 1 ? 'permission' : 'permissions'} in all
                      </span>
                    </>
                  ) : (
                    `${r.permissions.length} ${r.permissions.length === 1 ? 'permission' : 'permissions'}`
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular">{r.staffCount}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<EditIcon />}
                        className="mr-2"
                        onClick={() => {
                          setMessage(null);
                          setError(null);
                          setDraft({
                            id: r.id,
                            name: r.name,
                            description: r.description ?? '',
                            permissions: [...r.permissions],
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <DeleteRoleButton
                        onDelete={async () => {
                          if (!(await send(`/${r.id}`, undefined, 'DELETE')))
                            throw new Error('rejected');
                        }}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
            {loaded && roles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-oat">
                  No roles yet.{' '}
                  {canManage && 'Use “Restore standard roles” to get the usual set back.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {canManage && (
        <p className="text-[11px] text-oat rise rise-4">
          Deleting a role that people still hold is refused — they would be left able to sign in and
          do nothing. Move them to another role first.
        </p>
      )}
    </div>
  );
}

function RoleEditor({
  draft,
  setDraft,
  catalogue,
  held,
  original,
  onSubmit,
  state,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  catalogue: Catalogue;
  held: string[];
  /** What the role held when the editor opened — those may be removed even if not yours to give. */
  original: string[];
  onSubmit: (e: React.FormEvent) => void;
  state: ActionState;
}) {
  const holds = (code: string) => held.includes(code);
  const chosen = new Set(draft.permissions);

  const toggle = (code: string) => {
    const next = new Set(draft.permissions);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraft({ ...draft, permissions: [...next] });
  };

  const missing = catalogue.permissions.filter((p) => !holds(p.code)).length;

  return (
    <form onSubmit={onSubmit} className="card p-6 rise rise-2">
      <h2 className="font-display text-xl">{draft.id ? `Edit ${draft.name}` : 'New role'}</h2>
      <p className="text-xs text-oat mt-1">
        Name it for the job, not the person — the school will still be using it after they leave.
      </p>

      <div className="flex flex-wrap gap-3 mt-4">
        <label className="text-[13px]">
          <span className="block text-oat mb-1">Name</span>
          <input
            required
            minLength={2}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Accounts Clerk"
            className={`${field} w-56`}
          />
        </label>
        <label className="text-[13px] flex-1 min-w-[16rem]">
          <span className="block text-oat mb-1">What this job does</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Takes payments at the counter."
            className={`${field} w-full`}
          />
        </label>
      </div>

      {missing > 0 && (
        <p className="text-xs text-oat mt-5 border-l-2 border-gold pl-3">
          {missing} {missing === 1 ? 'permission is' : 'permissions are'} greyed out because you do
          not have {missing === 1 ? 'it' : 'them'} yourself. You cannot pass on access you do not
          hold. Anything already in this role can still be taken out.
        </p>
      )}

      <div className="mt-5 space-y-6">
        {catalogue.groups.map((group) => {
          const perms = catalogue.permissions.filter((p) => p.group === group);
          return (
            <fieldset key={group}>
              <legend className="text-[11px] uppercase tracking-widest text-oat">{group}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {perms.map((p) => {
                  const checked = chosen.has(p.code);
                  // Not yours to give, and not already in the role — the API would refuse it.
                  // Already in the role stays tickable so it can be removed.
                  const locked = !holds(p.code) && !(checked && original.includes(p.code));
                  return (
                    <label
                      key={p.code}
                      className={`flex gap-2.5 rounded-lg border p-2.5 text-[13px] ${
                        locked
                          ? 'border-mist/60 bg-parchment/60 cursor-not-allowed'
                          : 'border-mist hover:border-brand/40 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        disabled={locked}
                        onChange={() => toggle(p.code)}
                      />
                      <span className={locked ? 'text-oat' : ''}>
                        {p.label}
                        {p.caution && (
                          <span className="block text-[11px] text-clay mt-0.5">{p.caution}</span>
                        )}
                        {locked && (
                          <span className="block text-[11px] text-oat mt-0.5">
                            You do not have this yourself, so you cannot give it away.
                          </span>
                        )}
                        {!locked && !holds(p.code) && (
                          <span className="block text-[11px] text-oat mt-0.5">
                            Already in this role. You may take it out, but not put it back.
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-6 pt-5 border-t border-mist/60">
        <Button
          type="submit"
          state={state}
          icon={draft.id ? <SaveIcon /> : <PlusIcon />}
          disabled={draft.permissions.length === 0}
        >
          {draft.id ? 'Save role' : 'Create role'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
        <span className="text-[11px] text-oat ml-auto">
          {draft.permissions.length} chosen
          {draft.permissions.length === 0 && ' — a role must be able to do something'}
        </span>
      </div>
    </form>
  );
}

/**
 * One action per row: a hook cannot be called inside the map, and a shared pending state would
 * spin every row's button whenever any one of them was deleting. The API's reason for a refusal
 * ("3 people hold this role…") still arrives in the page-level error line.
 */
function DeleteRoleButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const action = useAsyncAction(onDelete);
  return (
    <Button
      onClick={action.run}
      state={action.state}
      variant="danger"
      size="sm"
      icon={<TrashIcon />}
    >
      Delete
    </Button>
  );
}
