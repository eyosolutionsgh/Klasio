'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Combobox from './Combobox';
import { Button, useAsyncAction } from './Button';
import { CashIcon, PlusIcon } from './icons';

interface Rule {
  id: string;
  name: string;
  kind: 'SCHOLARSHIP' | 'SIBLING';
  basis: 'PERCENT' | 'AMOUNT';
  value: number;
  fromSibling: number | null;
  levelId: string | null;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
  awardCount: number;
}
interface StudentOption {
  id: string;
  name: string;
  admissionNo: string;
  className: string;
}
export interface LevelOption {
  id: string;
  name: string;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });

/** 2 → "2nd". Used for "starts at the 3rd child", which is how a school says it out loud. */
function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${tail}`;
}

const kindLabel = (r: Pick<Rule, 'kind'>) =>
  r.kind === 'SCHOLARSHIP' ? 'Scholarship' : 'Sibling discount';

const field =
  'rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const KINDS = [
  { value: 'SCHOLARSHIP', label: 'Scholarship', hint: 'Awarded to named children' },
  { value: 'SIBLING', label: 'Sibling discount', hint: 'Applies to families automatically' },
];
const BASES = [
  { value: 'PERCENT', label: 'Percentage of the bill' },
  { value: 'AMOUNT', label: 'Fixed amount off' },
];

const errorText = (body: { message?: string | string[] }, fallback: string) =>
  Array.isArray(body.message) ? body.message.join('. ') : (body.message ?? fallback);

/**
 * Standing rules for money the school lets a family off.
 *
 * The two kinds are not variations of one thing and the page does not pretend they are. A
 * scholarship is held by a named child; a sibling discount is held by a *family* and is worked
 * out afresh every time bills are raised, which is why it can never be awarded to anyone.
 */
export default function ConcessionRules({ levels }: { levels: LevelOption[] }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [entitled, setEntitled] = useState(true);
  // Defaults to GHS so the first paint never shows a currency this school does not use.
  const [currency, setCurrency] = useState('GHS');

  const money = (n: number) =>
    `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Create form
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'SCHOLARSHIP' | 'SIBLING'>('SCHOLARSHIP');
  const [basis, setBasis] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [fromSibling, setFromSibling] = useState('2');
  const [levelId, setLevelId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  // Failure only — the API's reason for refusing a rule is what the button cannot say.
  const [message, setMessage] = useState<string | null>(null);

  // Award form
  const [awardRuleId, setAwardRuleId] = useState('');
  const [awardStudentId, setAwardStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [awardError, setAwardError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/fees/concessions/rules');
    // A 403 means this school's package does not include concessions, so the section is simply
    // not part of its portal rather than a locked door.
    if (res.status === 403) setEntitled(false);
    else if (res.ok) setRules(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/proxy/me')
      .then((r) => r.json())
      .then((me) => {
        setCanManage(['OWNER', 'HEAD'].includes(me?.user?.role));
        if (me?.school?.currency) setCurrency(me.school.currency);
      })
      .catch(() => setCanManage(false));
    fetch('/api/proxy/students')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setStudents(Array.isArray(rows) ? rows : []))
      .catch(() => setStudents([]));
  }, [load]);

  const scholarships = useMemo(
    () => (rules ?? []).filter((r) => r.kind === 'SCHOLARSHIP' && r.active),
    [rules],
  );

  const create = useAsyncAction(async () => {
    setMessage(null);
    const res = await fetch('/api/proxy/fees/concessions/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        kind,
        basis,
        value: Number(value),
        fromSibling: kind === 'SIBLING' ? Number(fromSibling) : undefined,
        levelId: levelId || undefined,
        startsOn: startsOn ? new Date(startsOn).toISOString() : undefined,
        endsOn: endsOn ? new Date(endsOn).toISOString() : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The API's own wording explains *why* — a clashing name, a percentage out of range, a
      // sibling rule starting at the eldest — far better than anything generic here.
      setMessage(errorText(body, 'Could not save that rule.'));
      throw new Error('create rejected');
    }
    setName('');
    setValue('');
    setStartsOn('');
    setEndsOn('');
    load();
  });

  const setActive = useCallback(
    async (rule: Rule, active: boolean) => {
      setMessage(null);
      const res = await fetch(`/api/proxy/fees/concessions/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        setMessage(errorText(await res.json().catch(() => ({})), 'Could not change that rule.'));
        throw new Error('toggle rejected');
      }
      load();
    },
    [load],
  );

  const award = useAsyncAction(async () => {
    setAwardError(null);
    const res = await fetch('/api/proxy/fees/concessions/awards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ruleId: awardRuleId,
        studentId: awardStudentId,
        reason: reason.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAwardError(errorText(body, 'Could not award that scholarship.'));
      throw new Error('award rejected');
    }
    // No success note: the button says "Awarded!", and "it applies from the next bill raised" is
    // already stated under this form for every award, not just the one just made.
    setAwardStudentId('');
    setReason('');
    load();
  });

  if (!loaded || !entitled || !rules) return null;

  const levelName = (id: string | null) =>
    id ? (levels.find((l) => l.id === id)?.name ?? 'One level') : 'All levels';

  return (
    <section className="card mt-6 rise rise-3 overflow-hidden">
      <div className="p-6 pb-0">
        <h2 className="font-display text-xl">Concessions</h2>
        <p className="text-sm text-oat mt-1.5">
          Standing rules for money the school lets a family off. A <strong>scholarship</strong> is
          awarded to named children and follows them wherever they are billed. A{' '}
          <strong>sibling discount</strong> belongs to a family, not a child: it is worked out
          afresh each time bills are raised, from who is actually on the roll that term, so it is
          never awarded to anyone.
        </p>
      </div>

      {/* From `sm` up the table scrolls inside its own card rather than widening the page; below
          it, each rule becomes a card. The floor is `sm:min-w-` and not `min-w-` on purpose — an
          unconditional 620px floor survives the stacking rules and puts the horizontal scrollbar
          straight back on a handset. */}
      <div className="overflow-x-auto mt-5 table-stack-wrap">
        <table className="w-full text-sm sm:min-w-[620px] table-stack">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-y border-mist bg-parchment/50">
              <th className="px-5 py-3 font-medium">Rule</th>
              <th className="px-5 py-3 font-medium">Reaches</th>
              <th className="px-5 py-3 font-medium text-right">Worth</th>
              <th className="px-5 py-3 font-medium text-right">Held by</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                canManage={canManage}
                levelName={levelName}
                money={money}
                setActive={setActive}
              />
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-oat">
                  No concession rules yet — every student is billed in full.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-6 pt-5 space-y-2 text-xs text-oat">
        {/* Two facts a school will otherwise get wrong, stated as plainly as they can be. */}
        <p className="rounded-lg bg-parchment/60 px-3.5 py-3">
          <strong className="text-ink">Rules stack.</strong> A child who qualifies for both a 50%
          scholarship and a 25% sibling discount is let off <strong>75%</strong> of the bill, not
          62.5% — each percentage is taken from the original bill, not from what is left after the
          other. The total is then capped at the bill itself, so a concession can never exceed the
          bill it discounts.
        </p>
        <p className="rounded-lg bg-parchment/60 px-3.5 py-3">
          <strong className="text-ink">Deactivating does not undo past discounts.</strong> The
          discounts already written against billed terms were correct when those terms were billed,
          and the fee ledger is append-only — they stand. Only future bills change.
        </p>
        <p className="rounded-lg bg-parchment/60 px-3.5 py-3">
          <strong className="text-ink">The eldest always pays in full.</strong> Children are ranked
          by enrolment date, eldest first, across every family a guardian has on the roll. A sibling
          rule that starts at the 2nd child leaves the first child&apos;s bill untouched, and
          enrolling a younger sibling never re-ranks the children already being billed.
        </p>
      </div>

      {canManage && (
        <form onSubmit={create.run} className="p-6 pt-0">
          <h3 className="text-sm font-medium">Add a rule</h3>
          <div className="flex flex-wrap items-end gap-3 mt-3">
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Rule name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Head's bursary"
                className={`${field} w-48`}
              />
            </label>
            <Combobox
              label="Kind"
              className="w-52"
              allowClear={false}
              placeholder="Search kinds…"
              options={KINDS}
              value={kind}
              onChange={(v) => setKind(v as 'SCHOLARSHIP' | 'SIBLING')}
            />
            <Combobox
              label="Worked out as"
              className="w-56"
              allowClear={false}
              placeholder="Search…"
              options={BASES}
              value={basis}
              onChange={(v) => setBasis(v as 'PERCENT' | 'AMOUNT')}
            />
            <label className="text-[13px]">
              <span className="block text-oat mb-1">
                {basis === 'PERCENT' ? 'Percent off' : `Amount off (${currency})`}
              </span>
              {/* The cash mark only when the field actually holds money — the same box takes a
                  percentage under the other basis, where a currency icon would be a lie. */}
              <div className="relative">
                {basis === 'AMOUNT' && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/70">
                    <CashIcon />
                  </span>
                )}
                <input
                  required
                  type="number"
                  min={basis === 'PERCENT' ? '0.01' : '0'}
                  max={basis === 'PERCENT' ? '100' : undefined}
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={`${field} w-32 tabular ${basis === 'AMOUNT' ? 'pl-10' : ''}`}
                />
              </div>
            </label>
            {kind === 'SIBLING' && (
              <label className="text-[13px]">
                <span className="block text-oat mb-1">Starts at child</span>
                <input
                  type="number"
                  min="2"
                  step="1"
                  value={fromSibling}
                  onChange={(e) => setFromSibling(e.target.value)}
                  data-tip="Counting eldest first. 2 means the eldest pays in full and every child after gets it."
                  className={`tip ${field} w-32 tabular`}
                />
              </label>
            )}
            <Combobox
              label="Level"
              className="w-44"
              clearLabel="All levels"
              placeholder="Search levels…"
              options={levels.map((l) => ({ value: l.id, label: l.name }))}
              value={levelId}
              onChange={setLevelId}
            />
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Starts on</span>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className={`${field} w-40 tabular`}
              />
            </label>
            <label className="text-[13px]">
              <span className="block text-oat mb-1">Ends on</span>
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className={`${field} w-40 tabular`}
              />
            </label>
            <Button type="submit" state={create.state} icon={<PlusIcon />}>
              Add rule
            </Button>
          </div>
          <p className="text-xs text-oat mt-2">
            {kind === 'SIBLING'
              ? 'Nobody is named on a sibling discount — it reaches every family with enough children on the roll, from the next bill raised.'
              : 'A scholarship does nothing until it is awarded to a child, below.'}
            {' Leave the dates empty for a rule that runs until it is deactivated.'}
          </p>
          {message && <p className="text-sm text-danger mt-3">{message}</p>}
        </form>
      )}

      {canManage && scholarships.length > 0 && (
        <form onSubmit={award.run} className="p-6 pt-0">
          <h3 className="text-sm font-medium">Award a scholarship</h3>
          <p className="text-xs text-oat mt-1">
            Only scholarships are listed here. A sibling discount applies to families automatically
            and cannot be awarded to a child.
          </p>
          <div className="flex flex-wrap items-end gap-3 mt-3">
            <Combobox
              label="Scholarship"
              className="w-56"
              allowClear={false}
              placeholder="Search scholarships…"
              options={scholarships.map((r) => ({
                value: r.id,
                label: r.name,
                hint: r.basis === 'PERCENT' ? `${r.value}% off` : `${money(r.value)} off`,
              }))}
              value={awardRuleId}
              onChange={setAwardRuleId}
            />
            <Combobox
              label="Child"
              className="w-60"
              allowClear={false}
              placeholder="Search students…"
              options={students.map((s) => ({
                value: s.id,
                label: s.name,
                hint: `${s.admissionNo} · ${s.className}`,
              }))}
              value={awardStudentId}
              onChange={setAwardStudentId}
            />
            <label className="text-[13px] flex-1 min-w-[14rem]">
              <span className="block text-oat mb-1">Reason</span>
              <input
                required
                minLength={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Top of the class, 2024/25"
                className={`${field} w-full`}
              />
            </label>
            <Button
              type="submit"
              state={award.state}
              disabled={!awardRuleId || !awardStudentId}
              icon={<CashIcon />}
              pendingLabel="Awarding…"
              doneLabel="Awarded!"
              failedLabel="Couldn't award"
            >
              Award
            </Button>
          </div>
          <p className="text-xs text-oat mt-2">
            The reason is kept with the award and in the audit log. Awarding does not touch bills
            already raised — it applies from the next one.
          </p>
          {awardError && <p className="text-sm text-danger mt-3">{awardError}</p>}
        </form>
      )}
    </section>
  );
}

/**
 * One rule in the table.
 *
 * Its own component so the toggle can carry its own pending and outcome state — a queue of rules
 * sharing one flag could only say "something is happening somewhere".
 */
function RuleRow({
  rule: r,
  canManage,
  levelName,
  money,
  setActive,
}: {
  rule: Rule;
  canManage: boolean;
  levelName: (id: string | null) => string;
  money: (n: number) => string;
  setActive: (rule: Rule, active: boolean) => Promise<void>;
}) {
  /**
   * `r.active` flips the instant the reload lands, so the outcome wording is pinned to the
   * direction actually taken — otherwise deactivating a rule ends up announcing "Reactivated!".
   */
  const [went, setWent] = useState<'off' | 'on'>(r.active ? 'off' : 'on');
  const toggle = useAsyncAction(async () => {
    setWent(r.active ? 'off' : 'on');
    await setActive(r, !r.active);
  });
  const words =
    went === 'off'
      ? { pending: 'Deactivating…', done: 'Deactivated!', failed: "Couldn't deactivate" }
      : { pending: 'Reactivating…', done: 'Reactivated!', failed: "Couldn't reactivate" };

  return (
    <tr className="border-b border-mist/60 last:border-0">
      <td data-label="Rule" className="px-5 py-3">
        <p className={`font-medium ${r.active ? '' : 'text-oat'}`}>{r.name}</p>
        <p className="text-[11px] text-oat">
          {/* Schools name rules after what they are ("Sibling discount"), so repeating
              the kind underneath reads as a mistake. Dropped when it only echoes. */}
          {[
            kindLabel(r).toLowerCase() === r.name.trim().toLowerCase() ? null : kindLabel(r),
            r.active ? null : 'inactive',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </td>
      <td data-label="Reaches" className="px-5 py-3 text-oat">
        {r.kind === 'SIBLING'
          ? `${ordinal(r.fromSibling ?? 2)} child onward`
          : 'Children awarded it'}
        <span className="block text-[11px]">
          {levelName(r.levelId)}
          {r.startsOn && ` · from ${fmtDate(r.startsOn)}`}
          {r.endsOn && ` · until ${fmtDate(r.endsOn)}`}
        </span>
      </td>
      <td data-label="Worth" className="px-5 py-3 text-right tabular font-medium">
        {r.basis === 'PERCENT' ? `${r.value}%` : money(r.value)}
        {r.basis === 'PERCENT' && (
          <span className="block text-[11px] font-normal text-oat">of the bill</span>
        )}
      </td>
      <td data-label="Held by" className="px-5 py-3 text-right">
        {r.kind === 'SCHOLARSHIP' ? (
          <span className="tabular">
            {r.awardCount} {r.awardCount === 1 ? 'child' : 'children'}
          </span>
        ) : (
          <span
            data-tip="Worked out from the roll at billing — nobody is named on it"
            className="tip text-oat text-[12.5px]"
          >
            Automatic
          </span>
        )}
      </td>
      <td className="px-5 py-3">
        {canManage && (
          <div className="flex justify-end">
            {/* Kept as the quiet treatment it already had: deactivating changes nothing already
                billed, so it is a setting rather than a destructive act. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggle.run}
              state={toggle.state}
              data-tip={
                r.active
                  ? 'Stops it applying to future bills; discounts already given stand'
                  : 'It will apply again from the next bill raised'
              }
              className="tip"
              pendingLabel={words.pending}
              doneLabel={words.done}
              failedLabel={words.failed}
            >
              {r.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
