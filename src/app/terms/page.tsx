import { getServices } from "@/server/container";
import { Contact, LegalPage, legalMetadata } from "../legal/Legal";

export const dynamic = "force-dynamic";
export const metadata = legalMetadata("Terms of use", "The rules for using FocusX and its monthly plan.");

export default async function Terms() {
  const price = await getServices().repos.planPrices.get();
  return (
    <LegalPage title="Terms of use">
      <p>By using FocusX you agree to these terms. They are written to be read.</p>

      <h2>The app</h2>
      <p>
        FocusX helps you study with a focus timer, app blocking, a planner, screen-time stats and an AI study friend (“Buddy”). Blocking works only while a focus
        session is running and only after you allow the Accessibility permission.
      </p>

      <h2>The plan</h2>
      <ul>
        <li>
          Two plans, billed monthly through Razorpay (UPI, cards, net banking), each with a <strong>3-day free trial</strong> for new subscribers: the <strong>Student plan, ₹{price.student} per month</strong>, for a
          student’s own use, and the <strong>Parent plan, ₹{price.parent} per month</strong>, which also lets a parent add up to 3 children who then use it at no extra cost. Only the Parent plan can add
          children. The price shown in the app at purchase time is the one that applies.
        </li>
        <li>
          The subscription renews every month until you cancel. Cancel any time in the app (Profile › Manage plan); you keep access until the end of the
          period you paid for. If you cancel during the trial you are not charged.
        </li>
        <li>Payments are processed by Razorpay. If you were charged by mistake or something went wrong, write to us at the contact address below and we will look into it and refund where it is due.</li>
        <li>Timer sessions, blocking and Buddy need an active trial or subscription (a child uses the parent’s plan; if it ends or the parent pauses the child, access stops). Setting up the app is free.</li>
      </ul>

      <h2>Your account</h2>
      <p>
        You sign in with your mobile number. Keep your phone secure; you are responsible for activity on your account. You can delete your account at any time (see
        the <a href="/delete-account">deletion page</a>).
      </p>

      <h2>Buddy</h2>
      <p>
        Buddy is an AI. It can be wrong, so check facts that matter, and it is not a doctor, lawyer, counsellor or tutor. If you feel unsafe or hopeless, please talk
        to someone you trust; in India you can call Tele-MANAS on 14416 (free, 24x7). There is a daily message limit.
      </p>

      <h2>Fair use</h2>
      <p>
        Do not misuse the service: no flooding sign-in or chat requests, no attempts to break or bypass the plan or blocking, no unlawful or abusive messages to
        Buddy. We may limit or suspend accounts that do.
      </p>

      <h2>Our responsibility</h2>
      <p>
        We work hard to keep FocusX running and your data safe, but the app is provided “as is”. Blocking depends on Android and on other apps behaving normally, so
        it may not stop every distraction. To the extent the law allows, our liability is limited to the amount you paid us in the last 3 months. Nothing here
        limits rights you have under Indian consumer law.
      </p>

      <h2>Changes and law</h2>
      <p>We may update these terms and will tell you in the app when it matters. These terms are governed by the laws of India.</p>

      <h2>Contact</h2>
      <p><Contact /></p>
    </LegalPage>
  );
}
