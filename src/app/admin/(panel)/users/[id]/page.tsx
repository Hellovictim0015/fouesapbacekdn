import Link from "next/link";
import { notFound } from "next/navigation";
import { assignAppAction, deleteUserAction, unassignAppAction } from "@/server/admin/actions";
import { adminPool, getUserDetail } from "@/server/admin/queries";
import { goalText, suggestFor } from "@/server/apps/match";
import { getServices } from "@/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · User" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; assigned?: string }> };

const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function UserPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, assigned: justAssigned } = await searchParams;
  const u = await getUserDetail(adminPool(), id);
  if (!u) notFound();

  // Apps being suggested to this student: assigned by hand first, then the ones matching what they typed.
  const { repos } = getServices();
  const allApps = await repos.recommendedApps.list();
  const assignedIds = (await repos.recommendedApps.assignedFor([u.id])).get(u.id) ?? [];
  const suggestions = suggestFor(allApps, assignedIds, goalText({ prepGoal: u.prepGoal, exam: u.exam }), 10);
  const payments = await repos.payments.listForUser(u.id, 20);
  const assignable = allApps.filter((a) => a.active && !assignedIds.includes(a.id));

  const rows: [string, string][] = [
    ["Name", u.name ?? "—"],
    ["Email", u.email ?? "—"],
    ["Phone", u.phone ?? "—"],
    ["Exam", u.exam ?? "—"],
    ["Preparing for", u.prepGoal ?? "—"],
    ["Daily goal", `${u.dailyGoalMin} min`],
    ["Joined", stamp(u.createdAt)],
    ["Auth id", u.authUid],
  ];

  return (
    <>
      <p><Link href="/admin/users">← All users</Link></p>
      <h1>{u.name ?? u.email ?? u.phone ?? "User"}</h1>

      <div className="card">
        <h2>Profile</h2>
        <dl>{rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}</dl>
      </div>

      <div className="card">
        <h2>Plan</h2>
        <p><span className={`pill ${u.plan.status}`}>{u.plan.status}</span>{u.plan.expiresAt && <> until {u.plan.expiresAt.slice(0, 16).replace("T", " ")} UTC</>}</p>
        {u.subscription ? (
          <dl>
            <div><dt>Product</dt><dd>{u.subscription.productId}</dd></div>
            <div><dt>Stored status</dt><dd>{u.subscription.storedStatus}</dd></div>
            <div><dt>Razorpay status</dt><dd>{u.subscription.playState ?? "—"}</dd></div>
            <div><dt>Auto-renew</dt><dd>{u.subscription.autoRenewing ? "yes" : "no"}</dd></div>
            <div><dt>Razorpay subscription</dt><dd>{u.subscription.purchaseToken}</dd></div>
          </dl>
        ) : <p className="muted">No subscription yet.</p>}
      </div>

      <div className="card table-wrap">
        <h2>Payments</h2>
        {payments.length === 0 ? <p className="muted">No payments yet.</p> : (
          <table>
            <thead><tr><th>When</th><th>Plan</th><th>Amount</th><th>Status</th><th>How they paid</th><th>Payment id</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.paymentId}>
                  <td>{stamp(p.createdAt)}</td>
                  <td>{p.tier ?? "—"}</td>
                  <td>₹{(p.amountPaise / 100).toLocaleString("en-IN")}</td>
                  <td><span className={`pill ${p.status === "captured" ? "active" : p.status === "failed" ? "expired" : "trial"}`}>{p.status}</span>{p.errorText && <div className="muted">{p.errorText}</div>}</td>
                  <td>{[p.method, p.detail].filter(Boolean).join(" · ") || "—"}</td>
                  <td><code>{p.paymentId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Suggested apps</h2>
        {justAssigned && <p className="notice">Assigned.</p>}
        <p className="muted">
          What this student sees on Home and in Buddy’s answers: apps you assign by hand (★) first, then apps whose keywords match what they typed
          {u.prepGoal ? <> (“{u.prepGoal}”)</> : <> (they typed nothing)</>}.
        </p>
        {suggestions.length === 0 && <p>None right now.</p>}
        {suggestions.map(({ app, assigned }) => (
          <div key={app.id} className="inline" style={{ alignItems: "center", marginBottom: 8 }}>
            <span className={`chip ${assigned ? "assigned" : ""}`}>{assigned ? "★ " : ""}{app.name}</span>
            <span className="muted">{assigned ? "assigned by hand" : "matches what they typed"}</span>
            {assigned && (
              <form action={unassignAppAction} className="inline">
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="appId" value={app.id} />
                <button type="submit" className="ghost">Remove</button>
              </form>
            )}
          </div>
        ))}
        {assignable.length > 0 ? (
          <form action={assignAppAction} className="inline" style={{ marginTop: 12 }}>
            <input type="hidden" name="userId" value={u.id} />
            <select name="appId" defaultValue={assignable[0]!.id}>
              {assignable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="submit">Assign to this student</button>
          </form>
        ) : (
          <p className="muted">{allApps.length === 0 ? "Add apps under Apps first." : "Every visible app is already assigned."}</p>
        )}
      </div>

      <div className="card">
        <h2>Data we hold</h2>
        <p className="muted">Only counts are shown. The panel never displays what someone studied or asked Buddy.</p>
        {u.backup ? (
          <p>Cloud backup: {u.backup.sessions} sessions, {(u.backup.bytes / 1024).toFixed(1)} KB, saved {stamp(u.backup.updatedAt)}.</p>
        ) : <p>No cloud backup.</p>}
        {u.aiUsage.length > 0 && <p>Buddy chats, last days: {u.aiUsage.map((a) => `${a.day} · ${a.chats}`).join("  |  ")}</p>}
      </div>

      <div className="card danger">
        <h2>Delete this user</h2>
        <p>Removes the profile, subscription record, cloud backup and AI counters, and the sign-in. This cannot be undone. Any Razorpay subscription is cancelled so it stops charging. Past payments stay in the Payments list for the books.</p>
        {error === "confirm" && <p className="error" role="alert">Type DELETE to confirm.</p>}
        <form action={deleteUserAction} className="inline">
          <input type="hidden" name="id" value={u.id} />
          <input name="confirm" placeholder="Type DELETE" autoComplete="off" />
          <button type="submit" className="danger-btn">Delete user</button>
        </form>
      </div>
    </>
  );
}
