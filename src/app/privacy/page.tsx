import { Contact, LegalPage, legalMetadata } from "../legal/Legal";

export const dynamic = "force-dynamic"; // reads CONTACT_EMAIL at request time
export const metadata = legalMetadata("Privacy policy", "What FocusX collects, why, and how to delete it.");

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        FocusX (“we”, “us”) is a study-focus app for students in India, made by TechByteX. This page explains what the app
        and our server collect, what stays on your phone, who else handles your data, and how to delete it.
      </p>

      <h2>What stays on your phone only</h2>
      <ul>
        <li><strong>Which apps you use and for how long</strong> (screen time, via Android “Usage access”), and your list of apps to block.</li>
        <li>
          <strong>What the Accessibility service sees.</strong> During a focus session it checks which app or Shorts/Reels screen is open so it can block it.
          It does not read messages, passwords or anything you type, takes no screenshots, and nothing it sees is stored or sent anywhere.
        </li>
        <li>Your settings, theme and language.</li>
      </ul>

      <h2>What our server collects</h2>
      <ul>
        <li><strong>Your mobile number</strong>, to sign you in with a code (by WhatsApp or SMS) and identify your account. Children signing in with a parent’s code have no number.</li>
        <li><strong>Your study profile:</strong> the exam you picked, your daily goal, and, if you choose to type it at sign-in, what you are preparing for (an AI tidies the spelling; you can skip it).</li>
        <li>
          <strong>Cloud backup</strong> (only when you are signed in): your finished study sessions (times, subject, minutes, optional note), your planner entries and subject tags,
          so a new phone can restore them. Screen-time data and the block list are never part of it.
        </li>
        <li>
          <strong>Subscription status:</strong> whether your plan is trial, active or expired, its end date, and the Razorpay subscription and payment ids used to verify it, the amount, and how you paid (for example UPI, or card network and last four digits).
          We never see your full card number, CVV, UPI PIN or bank login; Razorpay handles payment.
        </li>
        <li><strong>Buddy (AI) usage:</strong> a count of messages per day, and the short line shown on your Home screen.</li>
        <li><strong>Temporary technical data:</strong> your IP address is used for a short time (about an hour) to limit abuse such as code flooding.</li>
      </ul>

      <h2>App suggestions</h2>
      <p>
        FocusX may suggest other study apps on the Home screen and in Buddy’s answers. We pick them by matching what you typed under “What are you preparing for?” to the exam each app is
        for. No data about you is sent to those apps: a suggestion is only a link, and nothing is shared unless you tap it and then use that app under its own policy.
      </p>

      <h2>Parents and children</h2>
      <p>
        A parent account can add up to 3 children. A child signs in with a one-time code made by the parent, with <strong>no phone number</strong>, and uses the
        parent’s plan. By adding a child, the parent confirms they are that child’s parent or legal guardian and agrees to the following.
      </p>
      <ul>
        <li>We store the child’s first name, what they are preparing for (if the parent typed it), and the same cloud backup as any student (sessions, planner, subject tags).</li>
        <li><strong>The parent sees study totals only</strong>: minutes studied today and this week and the number of sessions. The parent does not see subjects, notes, chats with Buddy, or which apps the child uses.</li>
        <li>The parent can pause the child’s access, make a new sign-in code (which signs the child out of other phones), or remove the child, which deletes the child’s profile and everything they saved.</li>
        <li>
          <strong>Uninstall lock.</strong> On a child’s phone, FocusX asks to become a device administrator so Android will not uninstall it until the parent gives a one-time code. It asks for no
          other administrator powers: it cannot read messages or photos, lock the screen, wipe data or change settings. While the lock is on, the Accessibility service also keeps the child out of
          FocusX’s own uninstall and Settings pages and shows a screen asking for the parent’s code. This is a speed bump, not a guarantee: a factory reset or safe mode can still remove the app.
        </li>
        <li>Children are not shown ads and we do not profile them.</li>
      </ul>

      <h2>Buddy, our AI study friend</h2>
      <p>
        When you chat, the app sends your last few messages, your exam, and three numbers (minutes studied today, your goal, your streak) through our server to{" "}
        <strong>OpenAI</strong>, which writes the reply. The same goes for the text you type in the optional “what are you preparing for” box, and for the daily study-tip lines. We do not store the conversation. OpenAI processes it under its own terms and privacy policy.
        Please do not share sensitive personal details in the chat.
      </p>

      <h2>Who else handles data (processors)</h2>
      <ul>
        <li><strong>Fast2SMS</strong>, to send your sign-in code by WhatsApp or SMS (it receives your number and the code).</li>
        <li><strong>OpenAI</strong>, to generate Buddy replies (see above).</li>
        <li><strong>Razorpay</strong>, to take payments and run your monthly subscription (it receives your phone number and payment details).</li>
        <li>Our hosting and database provider.</li>
      </ul>
      <p>We do not sell your data, show ads, or use advertising or analytics trackers in the app.</p>

      <h2>How long we keep it</h2>
      <p>Until you delete your account. Sign-in sessions expire after 90 days. Sign-in codes expire after 5 minutes.</p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Delete your account and cloud data</strong> any time: Profile › Delete account in the app, or see{" "}
          <a href="/delete-account">how to delete without the app</a>.
        </li>
        <li>Turn off the Accessibility service or Usage access in Android Settings whenever you like. The timer, planner and stats keep working.</li>
        <li>Ask us to see or correct your data: write to <Contact />.</li>
      </ul>

      <h2>Age</h2>
      <p>FocusX is for students aged 13 and over. If you are under 18, please use it with the knowledge and permission of a parent or guardian.</p>

      <h2>Security</h2>
      <p>Connections to our server use HTTPS. Sign-in tokens are stored as one-way hashes. No system is perfectly secure, but we limit what we collect so there is less to protect.</p>

      <h2>Changes and contact</h2>
      <p>If this policy changes in a way that matters, we will say so in the app. Questions: <Contact />.</p>
    </LegalPage>
  );
}
