import { adminPool, dashboardStats, paymentsSummary } from "@/server/admin/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Dashboard" };

export default async function Dashboard() {
  const [s, pay] = await Promise.all([dashboardStats(adminPool()), paymentsSummary(adminPool())]);
  const tiles: [string, number, string][] = [
    ["Users", s.users, `${s.newUsers7d} new in 7 days`],
    ["On trial", s.trials, "3-day free trial running"],
    ["Active", s.active, "paying subscribers"],
    ["Collected (30 days)", Math.round(pay.collectedPaise30d / 100), `₹ from ${pay.paid30d} payments`],
    ["Grace", s.grace, "payment retrying"],
    ["Expired", s.expired, "no access"],
    ["Backups", s.backups, "users with a cloud backup"],
    ["Buddy chats today", s.aiToday, "Indian date"],
  ];
  return (
    <>
      <h1>Dashboard</h1>
      <div className="tiles">
        {tiles.map(([label, value, hint]) => (
          <div className="card tile" key={label}>
            <span className="muted">{label}</span>
            <strong>{value.toLocaleString("en-IN")}</strong>
            <small className="muted">{hint}</small>
          </div>
        ))}
      </div>
    </>
  );
}
