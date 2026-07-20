'use client';

import { useActionState } from 'react';
import { setPackageArchived } from '@/lib/actions';

/**
 * Withdraw a package from sale, or put it back.
 *
 * Its own form on the card rather than a control inside the edit dialog. Two reasons, and the
 * second is the one that bites: withdrawing is not an edit, so burying it in "Edit" hides it; and
 * a submit button carrying `formAction` may not also carry a `name`, because React uses that
 * attribute for the action reference and the two silently collide into a hydration mismatch.
 */
export default function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [error, action, pending] = useActionState(setPackageArchived, null);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-clay underline underline-offset-2 disabled:opacity-60"
      >
        {archived ? 'Put back on sale' : 'Withdraw from sale'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger mt-1">
          {error}
        </p>
      )}
    </form>
  );
}
