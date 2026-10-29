import { sendAnnouncementAction } from "@/server/admin/actions";
import { adminPool, recentAnnouncements } from "@/server/admin/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Send notification" };

type Search = Promise<{ sent?: string; error?: string }>;

const ERRORS: Record<string, string> = {
  invalid: "Write a title (up to 80 characters) and a message (up to 300).",
  phone: "No account with that phone number.",
};

export default async function NotifyPage({ searchParams }: { searchParams: Search }) {
  const { sent, error } = await searchParams;
  const recent = await recentAnnouncements(adminPool());

  return (
    <>
      <h1>Send a notification</h1>
      {sent && <p className="notice">Sent. Phones pick it up within about an hour, or as soon as the app opens.</p>}
      {error && <p className="error" role="alert">{ERRORS[error] ?? "Could not send."}</p>}

      <form action={sendAnnouncementAction} className="card stack">
        <label>
          Who gets it
          <select name="audience" defaultValue="all">
            <option value="all">Everyone</option>
            <option value="students">Students</option>
            <option value="parents">Parents</option>
            <option value="children">Children (signed in with a parent’s code)</option>
            <option value="user">One person (enter their phone number)</option>
          </select>
        </label>
        <label>
          Phone number (only for “One person”)
          <input name="phone" inputMode="numeric" placeholder="9876543210" />
        </label>
        <label>
          Title
          <input name="title" maxLength={80} required placeholder="New: Pomodoro sounds" />
        </label>
        <label>
          Message
          <textarea name="body" maxLength={300} required rows={3} placeholder="Short and useful. Appears in the phone’s notification bar." />
        </label>
        <button type="submit">Send notification</button>
        <p className="muted">There is no push service: each phone checks for new messages about once an hour and whenever the app is opened.</p>
      </form>

      <h2>Recently sent</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When (UTC)</th><th>To</th><th>Title</th><th>Message</th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={4} className="muted">Nothing sent yet.</td></tr>}
            {recent.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                <td>{r.audience}</td>
                <td>{r.title}</td>
                <td style={{ whiteSpace: "normal" }}>{r.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
