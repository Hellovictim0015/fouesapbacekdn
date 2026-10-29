import { getServices } from "@/server/container";
import { handle, json } from "@/server/http/respond";

/**
 * GET /v1/plans (public): the prices to SHOW, in rupees a month. The paywall appears before sign-in, so no token is needed.
 * The app prefers the price Google Play reports and uses these numbers only when Play is not available.
 */
export function GET() {
  return handle(async () => {
    const p = await getServices().repos.planPrices.get();
    return json({ student: { priceInr: p.student }, parent: { priceInr: p.parent } });
  });
}
