/**
 * Vercel's build tooling for apps/api resolves a narrower ambient fetch/Response type than local
 * tsc does — enough to fail the whole build over the ordinary `.status`/`.ok`/`.json()`/`.text()`
 * usage every outbound HTTP call in this codebase relies on. Every `fetch()` result is cast
 * through this instead of trusting the ambient type directly, so the build succeeds regardless
 * of which shape either environment's TypeScript resolves it to.
 */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}

export function asResponse(res: unknown): FetchLikeResponse {
  return res as FetchLikeResponse;
}
