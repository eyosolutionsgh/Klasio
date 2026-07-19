/**
 * A fixed-window counter, used to decide when to stop *disclosing* something.
 *
 * Deliberately not a lockout. The guardian sign-in endpoint echoes back a masked phone and email
 * so a parent knows which device to check, and that echo is an oracle: a mask comes back for a
 * registered family and nothing for a stranger. Rather than refuse service once a caller looks
 * like they are sweeping, the endpoint keeps sending codes and simply stops describing where they
 * went — so a parent behind a carrier NAT (which in Ghana can put very many subscribers on one
 * address) is never locked out of their own portal, and the limit can therefore be set tight.
 *
 * State is plain data so the caller owns storage. Nothing here touches Redis: it is optional in
 * this product (see the payments sweep and fee reminders, which degrade without it) and a control
 * that silently disables itself on half the deployments is not a control.
 */
export interface RateWindow {
  hits: number;
  /** Epoch ms at which this window opened. */
  startedAt: number;
}

/** The state to store after one more request. A window that has run out starts over. */
export function recordHit(state: RateWindow | null, now: number, windowMs: number): RateWindow {
  if (!state || now - state.startedAt >= windowMs) return { hits: 1, startedAt: now };
  return { hits: state.hits + 1, startedAt: state.startedAt };
}

/**
 * Whether this caller has spent its allowance.
 *
 * Call *after* `recordHit`, so the request being served is itself counted — `max` is the number of
 * disclosures allowed in a window, not the number that may precede a refusal.
 */
export function isOverLimit(
  state: RateWindow | null,
  now: number,
  windowMs: number,
  max: number,
): boolean {
  if (!state) return false;
  if (now - state.startedAt >= windowMs) return false;
  return state.hits > max;
}

/**
 * Drop windows that have run out.
 *
 * Without this the map is a slow memory leak keyed by client address — every caller that ever
 * asked for a code stays resident for the life of the process.
 */
export function pruneWindows(
  windows: Map<string, RateWindow>,
  now: number,
  windowMs: number,
): void {
  for (const [key, state] of windows) {
    if (now - state.startedAt >= windowMs) windows.delete(key);
  }
}
