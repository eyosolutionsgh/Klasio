import type { Page } from '@playwright/test';

/**
 * Keep the gateway's redirect on the origin under test.
 *
 * The API builds its checkout and return URLs from its own `PUBLIC_BASE_URL`, which defaults to
 * `localhost:3000`. Any suite driving a different port follows that redirect off its own app —
 * and if nothing happens to be listening on 3000, straight into a connection refused. Both are
 * failures about the setup rather than about the product, and the second one only appears once
 * somebody's long-running dev server has died, which makes it look like flake.
 *
 * This rewrites the hop to wherever the test actually is, keeping the path the gateway chose, so
 * the real checkout page still loads and is still the thing being exercised. Requests already on
 * the right origin pass straight through.
 */
export async function keepGatewayOnThisOrigin(page: Page, baseURL?: string) {
  if (!baseURL) return;
  const here = new URL(baseURL).origin;

  await page.route(/\/pay\/mock\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === here) return route.continue();
    await route.fulfill({
      status: 302,
      headers: { location: `${here}${url.pathname}${url.search}` },
    });
  });
}
