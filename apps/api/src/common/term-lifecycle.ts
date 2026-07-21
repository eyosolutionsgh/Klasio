/**
 * What it means for a term to be closed.
 *
 * A term is not merely a date range that elapses. A Ghanaian school *closes* it: exams sat and
 * marked, SBA compiled, broadsheets built, reports vetted by the head and published, returns
 * filed. After that the academic record is settled history, and a register mark appearing against
 * a term whose reports went home three weeks ago is a correction nobody asked for.
 *
 * Before this, the only thing the software knew about a term was `isCurrent` — a pointer saying
 * which term to default to. Moving the pointer forward left every previous term wide open to
 * writes for ever.
 *
 * **Money is deliberately not frozen.** Arrears carry forward and a parent may settle last term's
 * bill months later; a closed term that refused a payment would be a closed term that lost money.
 * The ledger is append-only and dated, so it does not need a gate to stay honest.
 *
 * **Publishing stays open too.** Releasing a finished report is not editing it, and a school that
 * closes the term on Friday and releases results on Monday is doing the ordinary thing.
 */

export interface TermLike {
  id: string;
  name: string;
  closedAt: Date | null;
}

/** Message shown when a write lands on a closed term. Names the term and how to proceed. */
export function closedTermMessage(term: { name: string; closedAt: Date | null }): string {
  const on = term.closedAt
    ? ` on ${term.closedAt.toLocaleDateString('en-GH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`
    : '';
  return (
    `${term.name} was closed${on}, so its register and marks are settled. ` +
    'Reopen the term in School Setup if this genuinely needs to change.'
  );
}

/** True when the term may still take academic writes. */
export function termAcceptsWrites(term: { closedAt: Date | null } | null | undefined): boolean {
  return !!term && term.closedAt === null;
}
