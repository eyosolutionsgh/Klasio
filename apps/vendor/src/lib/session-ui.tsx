import { signOut } from './actions';

export { currentUser } from './session';

/** The sign-out control, as a form so it is a POST rather than a link that logs you out on prefetch. */
export function signOutForm() {
  return (
    <form action={signOut}>
      <button type="submit" className="text-oat hover:text-navy underline underline-offset-2">
        Sign out
      </button>
    </form>
  );
}
