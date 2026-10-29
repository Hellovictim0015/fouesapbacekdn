import { createAppAction, deleteAppAction, toggleAppAction, updateAppAction } from "@/server/admin/actions";
import { adminPool, allGoals } from "@/server/admin/queries";
import { appMatchesGoal, goalText } from "@/server/apps/match";
import { getServices } from "@/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "FocusX admin · Recommended apps" };

type Search = Promise<{ saved?: string; deleted?: string; error?: string }>;

const ERRORS: Record<string, string> = {
  invalid: "Check the name (up to 60), the description (up to 160) and that the link starts with https://.",
  too_big: "The logo is too big. Use a PNG, JPEG or WebP of at most 150 KB.",
  bad_type: "The logo must be a PNG, JPEG or WebP image (not SVG).",
};

export default async function AppsPage({ searchParams }: { searchParams: Search }) {
  const { saved, deleted, error } = await searchParams;
  const s = getServices();
  const apps = await s.repos.recommendedApps.list();
  const goals = await allGoals(adminPool());

  return (
    <>
      <h1>Recommended apps</h1>
      <p className="muted">
        Apps you want to suggest to students. A student sees an app on the Home screen, and Buddy mentions it in chat, only when what they typed under
        “What are you preparing for?” matches the app’s keywords. Someone preparing for GATE sees the GATE app, not the JEE/NEET one.
      </p>
      {saved && <p className="notice">Saved.</p>}
      {deleted && <p className="notice">Deleted.</p>}
      {error && <p className="error" role="alert">{ERRORS[error] ?? "Could not save."}</p>}

      <form action={createAppAction} className="card stack">
        <h2>Add an app</h2>
        <label>
          App name
          <input name="name" maxLength={60} required placeholder="GATE Prep Pro" />
        </label>
        <label>
          What it helps with (one or two lines)
          <textarea name="tagline" maxLength={160} required rows={2} placeholder="Full GATE CSE syllabus, mock tests and previous-year papers." />
        </label>
        <label>
          Link (https://… Play Store page or website)
          <input name="url" type="url" required placeholder="https://play.google.com/store/apps/details?id=…" />
        </label>
        <label>
          Logo (PNG, JPEG or WebP, up to 150 KB)
          <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        <label>
          Keywords (optional, comma separated)
          <input name="keywords" placeholder="Leave empty and the AI will work out which exams this app is for" />
        </label>
        <button type="submit">Add app</button>
      </form>

      {apps.length === 0 && <p className="muted">No apps yet.</p>}
      {apps.map((a) => {
        const students = goals.filter((g) => appMatchesGoal(a.keywords, goalText(g))).length;
        return (
          <div className="card" key={a.id}>
            <div className="app-head">
              {a.hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/v1/recommended-apps/${a.id}/logo?v=${a.updatedAt.getTime()}`} alt="" width={56} height={56} className="app-logo" />
              ) : (
                <div className="app-logo app-logo-empty" aria-hidden>{a.name.slice(0, 1)}</div>
              )}
              <div>
                <strong>{a.name}</strong> {a.active ? <span className="pill active">shown</span> : <span className="pill expired">hidden</span>}
                <div className="muted">{students.toLocaleString("en-IN")} of {goals.length.toLocaleString("en-IN")} students match right now</div>
              </div>
            </div>

            <form action={updateAppAction} className="stack">
              <input type="hidden" name="id" value={a.id} />
              <label>Name<input name="name" defaultValue={a.name} maxLength={60} required /></label>
              <label>What it helps with<textarea name="tagline" defaultValue={a.tagline} maxLength={160} required rows={2} /></label>
              <label>Link<input name="url" type="url" defaultValue={a.url} required /></label>
              <label>Replace logo (optional)<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /></label>
              <label>Keywords (comma separated)<input name="keywords" defaultValue={a.keywords.join(", ")} /></label>
              <div className="inline">
                <button type="submit" name="intent" value="save">Save changes</button>
                <button type="submit" name="intent" value="reanalyze" className="ghost">Re-analyze with AI</button>
              </div>
            </form>

            <div className="inline" style={{ marginTop: 12 }}>
              <form action={toggleAppAction} className="inline">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="active" value={a.active ? "0" : "1"} />
                <button type="submit" className="ghost">{a.active ? "Hide" : "Show"}</button>
              </form>
              <form action={deleteAppAction} className="inline">
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="danger-btn">Delete</button>
              </form>
            </div>
          </div>
        );
      })}
    </>
  );
}
