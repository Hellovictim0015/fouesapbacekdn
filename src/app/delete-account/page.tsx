import { Contact, LegalPage, legalMetadata } from "../legal/Legal";

export const dynamic = "force-dynamic";
export const metadata = legalMetadata("Delete your account", "How to delete your FocusX account and data.");

export default function DeleteAccount() {
  return (
    <LegalPage title="Delete your FocusX account">
      <h2>In the app (fastest)</h2>
      <ol>
        <li>Open FocusX and go to <strong>Me</strong> (Profile).</li>
        <li>In the Account card tap <strong>Delete account</strong>, then confirm. (A child cannot delete their own account: the parent removes the child under <strong>Me › My children</strong>.)</li>
      </ol>
      <p>
        This immediately erases your account (for a parent account, also every child you added, with everything they saved), cloud backup (sessions, planner, tags), subscription record, and Buddy counters from our server, and signs out every
        device. Your sessions on your phone stay until you uninstall the app.
      </p>

      <h2>Without the app</h2>
      <p>
        If you no longer have the app, write to <Contact /> and include the mobile number of your account. We will verify it is you (for example by sending a code to
        that number) and delete your data within 30 days.
      </p>

      <h2>Your subscription</h2>
      <p>
        Cancel your plan in the app first (Profile › Manage plan). Deleting your account also cancels it right away so you are not charged again; if you are not sure, write to us and we will check.
      </p>

      <h2>What we keep</h2>
      <p>
        Nothing about your study data. Google keeps its own payment records, and our server logs may briefly contain technical request data (such as IP addresses)
        that is removed automatically.
      </p>
    </LegalPage>
  );
}
