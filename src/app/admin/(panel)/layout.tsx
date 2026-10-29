import Link from "next/link";
import { logoutAction } from "@/server/admin/actions";
import { requireAdmin } from "@/server/admin/auth";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="panel">
      <header>
        <strong>FocusX admin</strong>
        <nav>
          <Link href="/admin">Dashboard</Link>
          <Link href="/admin/users">Users</Link>
          <Link href="/admin/notify">Notify</Link>
          <Link href="/admin/plans">Plans</Link>
          <Link href="/admin/payments">Payments</Link>
          <Link href="/admin/apps">Apps</Link>
        </nav>
        <form action={logoutAction}>
          <span className="muted">{admin.email}</span>
          <button type="submit" className="ghost">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
