import Link from "next/link";
import { clearRazorpayKeysAction, saveRazorpayKeysAction } from "@/server/admin/actions";
import { adminPool, listPayments, PAGE_SIZE, PAYMENT_STATUSES, paymentsSummary } from "@/server/admin/queries";
import { getServices } from "@/server/container";
import { razorpayStatus } from "@/server/pay/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Payments" };

type Search = Promise<{ q?: string; status?: string; page?: string; saved?: string; cleared?: string; error?: string }>;

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function PaymentsPage({ searchParams }: { searchParams: Search }) {
  const { q = "", status = "", page: pageParam, saved, cleared, error } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const s = getServices();
  const pool = adminPool();
  const [keys, summary, { rows, total }] = await Promise.all([
    razorpayStatus(s.repos.settings, s.env, s.authSecret),
    paymentsSummary(pool),
    listPayments(pool, q, status, page),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/admin/payments?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  const configured = keys.secretSet && keys.keyId;

  return (
    <>
      <h1>Payments</h1>
      {saved && <p className="notice">Razorpay keys saved.</p>}
      {cleared && <p className="notice">Razorpay keys removed. Payments are switched off until new keys are saved.</p>}
      {error && <p className="error" role="alert">Check the Key ID (it looks like rzp_test_xxxx or rzp_live_xxxx) and enter the Key Secret.</p>}

      <div className="tiles">
        <div className="card tile"><span className="muted">Collected, 30 days</span><strong>{rupees(summary.collectedPaise30d)}</strong><small className="muted">{summary.paid30d} payments</small></div>
        <div className="card tile"><span className="muted">Collected, all time</span><strong>{rupees(summary.collectedPaiseAll)}</strong><small className="muted">successful payments</small></div>
        <div className="card tile"><span className="muted">Failed, 30 days</span><strong>{summary.failed30d}</strong><small className="muted">payments that did not go through</small></div>
        <div className="card tile"><span className="muted">Student plans</span><strong>{summary.activeStudent}</strong><small className="muted">trial, active or grace</small></div>
        <div className="card tile"><span className="muted">Parent plans</span><strong>{summary.activeParent}</strong><small className="muted">trial, active or grace</small></div>
      </div>

      <div className="card stack">
        <h2>Razorpay keys</h2>
        <p>
          Status:{" "}
          {configured ? (
            <><span className={`pill ${keys.mode === "live" ? "active" : "trial"}`}>{keys.mode === "live" ? "LIVE: real money" : "TEST: no real money"}</span> using Key ID <code>{keys.keyId}</code> (secret {keys.secretHint}
            {keys.source === "env" ? ", set in the server environment" : ""}; webhook secret {keys.webhookSecretSet ? "saved" : "not set"})</>
          ) : (
            <span className="pill expired">Not set up: nobody can subscribe yet</span>
          )}
        </p>
        <form action={saveRazorpayKeysAction} className="stack" autoComplete="off">
          <label>
            Key ID
            <input name="keyId" defaultValue={keys.keyId ?? ""} placeholder="rzp_test_… or rzp_live_…" required spellCheck={false} />
          </label>
          <label>
            Key Secret {keys.secretSet && <span className="muted">(saved; leave empty to keep it)</span>}
            <input name="keySecret" type="password" placeholder={keys.secretSet ? keys.secretHint ?? "" : "From Razorpay Dashboard › Account & Settings › API keys"} autoComplete="new-password" spellCheck={false} />
          </label>
          <label>
            Webhook secret {keys.webhookSecretSet && <span className="muted">(saved; leave empty to keep it)</span>}
            <input name="webhookSecret" type="password" placeholder="The secret you type when you create the webhook" autoComplete="new-password" spellCheck={false} />
          </label>
          <button type="submit">Save keys</button>
        </form>
        {configured && (
          <form action={clearRazorpayKeysAction}>
            <button type="submit" className="danger">Remove keys</button>
          </form>
        )}
        <p className="muted">
          Secrets are stored encrypted and are never shown again, only their last 4 characters. Test keys (rzp_test_) never move real money; switch to live keys when you are ready.
        </p>
        <p>
          <strong>One-time Razorpay setup:</strong> in Razorpay Dashboard › Developers › Webhooks add the URL <code>https://YOUR-SERVER/v1/payments/webhook</code>, pick the events
          <code> subscription.*</code> and <code>payment.failed</code>, <code>payment.captured</code>, type a secret and paste the same secret in the Webhook secret box above.
          Subscriptions must be enabled on your Razorpay account (Dashboard › Subscriptions).
        </p>
      </div>

      <h2>All payments <span className="muted">({total.toLocaleString("en-IN")})</span></h2>
      <form className="search" method="get">
        <input name="q" defaultValue={q} placeholder="Search name, phone, email, payment id or subscription id" />
        <select name="status" defaultValue={status}>
          <option value="">Any status</option>
          {PAYMENT_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <button type="submit">Search</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Plan</th><th>Amount</th><th>Status</th><th>How they paid</th><th>Razorpay ids</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No payments yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.paymentId}>
                <td>{p.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                <td>
                  {p.userId ? <Link href={`/admin/users/${p.userId}`}>{p.userName ?? p.phone ?? "Unnamed"}</Link> : <span className="muted">{p.phone ?? "deleted user"}</span>}
                  {p.userName && p.phone && <div className="muted">{p.phone}</div>}
                </td>
                <td>{p.tier ?? "—"}</td>
                <td>{rupees(p.amountPaise)}</td>
                <td>
                  <span className={`pill ${p.status === "captured" ? "active" : p.status === "failed" ? "expired" : "trial"}`}>{p.status}</span>
                  {p.errorText && <div className="muted">{p.errorText}</div>}
                </td>
                <td>{[p.method, p.detail].filter(Boolean).join(" · ") || "—"}</td>
                <td><code>{p.paymentId}</code>{p.subscriptionId && <div className="muted"><code>{p.subscriptionId}</code></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="pager">
        {page > 1 ? <Link href={link(page - 1)}>← Newer</Link> : <span />}
        <span className="muted">Page {page} of {pages}</span>
        {page < pages ? <Link href={link(page + 1)}>Older →</Link> : <span />}
      </nav>
    </>
  );
}
