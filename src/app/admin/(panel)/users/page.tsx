import Link from "next/link";
import { adminPool, listUsers, PAGE_SIZE } from "@/server/admin/queries";
import { goalText, suggestFor } from "@/server/apps/match";
import { getServices } from "@/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Users" };

type Search = Promise<{ q?: string; page?: string; deleted?: string }>;

export default async function UsersPage({ searchParams }: { searchParams: Search }) {
  const { q = "", page: pageParam, deleted } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total } = await listUsers(adminPool(), q, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Which apps each of these students is being shown: the ones assigned by hand (★), then the ones matching what they typed.
  const { repos } = getServices();
  const [allApps, assigned] = await Promise.all([repos.recommendedApps.list(), repos.recommendedApps.assignedFor(rows.map((r) => r.id))]);
  const link = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <h1>Users <span className="muted">({total.toLocaleString("en-IN")})</span></h1>
      {deleted && <p className="notice">User deleted.</p>}
      <form className="search" method="get">
        <input name="q" defaultValue={q} placeholder="Search name, email, phone or Auth id" />
        <button type="submit">Search</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email / phone</th><th>Preparing for</th><th>Suggested apps</th><th>Plan</th><th>Joined</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No users found.</td></tr>}
            {rows.map((u) => (
              <tr key={u.id}>
                <td><Link href={`/admin/users/${u.id}`}>{u.name ?? "Unnamed"}</Link></td>
                <td>{u.email ?? u.phone ?? "—"}</td>
                <td>{u.prepGoal ?? u.exam ?? "—"}</td>
                <td>
                  {/* blank when nothing is being suggested */}
                  {suggestFor(allApps, assigned.get(u.id) ?? [], goalText(u)).map((x) => (
                    <span key={x.app.id} className={`chip ${x.assigned ? "assigned" : ""}`} title={x.assigned ? "Assigned by hand" : "Matches what they typed"}>
                      {x.assigned ? "★ " : ""}{x.app.name}
                    </span>
                  ))}
                </td>
                <td><span className={`pill ${u.plan.status}`}>{u.plan.status}</span></td>
                <td>{u.createdAt.toISOString().slice(0, 10)}</td>
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
