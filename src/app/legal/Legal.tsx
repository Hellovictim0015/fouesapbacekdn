import type { Metadata } from "next";
import Link from "next/link";

/** Shared frame for the public policy pages (privacy, terms, delete-account). Plain server components, no client JS. */
export const legalMetadata = (title: string, description: string): Metadata => ({
  title: `${title} · FocusX`,
  description,
  robots: { index: true, follow: true }, // unlike the rest of the site, these are meant to be found
});

export const UPDATED = "29 October 2026";

/** Set CONTACT_EMAIL in the server environment; the pages say so loudly if it is missing rather than showing a fake address. */
export function contactEmail(): string {
  return process.env.CONTACT_EMAIL ?? "";
}

export function Contact() {
  const email = contactEmail();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <strong>[contact email not configured: set CONTACT_EMAIL on the server]</strong>;
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="legal">
      <p><Link href="/">← FocusX</Link></p>
      <h1>{title}</h1>
      <p className="muted">Last updated {UPDATED}</p>
      {children}
      <footer className="muted">
        <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms</Link> · <Link href="/delete-account">Delete your account</Link>
      </footer>
    </main>
  );
}
