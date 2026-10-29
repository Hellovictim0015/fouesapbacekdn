import { savePlanPricesAction } from "@/server/admin/actions";
import { getServices } from "@/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Plans" };

type Search = Promise<{ saved?: string; error?: string }>;

export default async function PlansPage({ searchParams }: { searchParams: Search }) {
  const { saved, error } = await searchParams;
  const prices = await getServices().repos.planPrices.get();

  return (
    <>
      <h1>Plan prices</h1>
      {saved && <p className="notice">Saved. New subscribers are charged these prices, and the app and the terms page show them.</p>}
      {error && <p className="error" role="alert">Enter whole rupees between 1 and 9999.</p>}

      <form action={savePlanPricesAction} className="card stack">
        <label>
          Student plan (₹ per month)
          <input name="student" type="number" min={1} max={9999} step={1} defaultValue={prices.student} required />
        </label>
        <label>
          Parent plan (₹ per month, includes up to 3 children)
          <input name="parent" type="number" min={1} max={9999} step={1} defaultValue={prices.parent} required />
        </label>
        <button type="submit">Save prices</button>
      </form>

      <div className="card">
        <h2>How a price change works</h2>
        <p>
          These are the amounts Razorpay charges. The first time a price is used, FocusX creates a matching plan in your Razorpay account by itself. People who already
          subscribed keep paying the price they signed up at; the new price applies to new subscribers. Payments are set up on the <a href="/admin/payments">Payments</a> page.
        </p>
      </div>
    </>
  );
}
