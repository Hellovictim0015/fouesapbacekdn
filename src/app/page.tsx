import type { Metadata } from "next";
import Link from "next/link";
import { getServices } from "@/server/container";
import { contactEmail } from "./legal/Legal";
import "./landing/landing.css";

export const dynamic = "force-dynamic"; // prices are edited in the admin panel

const PLAY_URL = process.env.PLAY_STORE_URL ?? "https://play.google.com/store/apps/details?id=com.techbytex.foues";

export const metadata: Metadata = {
  title: "FocusX: the study focus app that blocks Shorts & Reels",
  description: "Block distracting apps, run focus timers, plan your day and ask an AI study buddy. 3 days free on Android.",
  robots: { index: true, follow: true },
};

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Icon({ d, size = 26 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d={d} />
    </svg>
  );
}

const Tick = () => (
  <span className="lp-tick">
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0a1a12" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  </span>
);

/** FocusX logo (phone with an X). Used on the lime tiles too, so the colours are fixed to the logo sheet. */
const Bolt = ({ size = 22 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
    <rect x="37" y="18" width="46" height="84" rx="13" fill="#0a1a12" stroke="#effff4" strokeWidth="6" />
    <path d="M49 47l22 22M71 47L49 69" stroke="#c8f560" strokeWidth="9" strokeLinecap="round" />
    <circle cx="60" cy="90" r="3.5" fill="#effff4" />
  </svg>
);

const PlayArrow = ({ color = "#0a1a12", size = 26 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={color}><path d="M6 3.5v17l14-8.5z" /></svg>
);

const FEATURES = [
  { tone: "lime", title: "Focus timer", text: "Start a session, pick your time, and everything distracting goes quiet until you are done.", d: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" },
  { tone: "dark", title: "App blocking", text: "Choose the apps that eat your hours. During a session they simply do not open.", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8" },
  { tone: "pink", title: "Kill Shorts & Reels", text: "Keep YouTube for lectures but block just the Shorts and Reels feeds.", d: "M4 6h16M4 12h10M4 18h6M17 14l4 4m0-4l-4 4" },
  { tone: "mint", title: "Screen-time stats", text: "See where the day went, which apps took it, and how your focus time grows week by week.", d: "M5 20V10m7 10V4m7 16v-7" },
  { tone: "amber", title: "Study planner", text: "Plan your sessions, get a reminder exactly when each one starts, and tick them off.", d: "M5 4h14v16H5zM9 2v4m6-4v4M9 12l2 2 4-4" },
  { tone: "lime", title: "AI study buddy", text: "Stuck, tired or tempted? Buddy explains, motivates and helps you plan, in English or Hinglish.", d: "M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z" },
] as const;

const STEPS = [
  { n: 1, color: "#c8f560", title: "Pick your distractions", text: "Choose the apps and feeds to block. Takes a minute, once." },
  { n: 2, color: "#8ff0b4", title: "Start the timer", text: "Set your study time and go. Blocked apps stay shut until it ends." },
  { n: 3, color: "#ff8fd8", title: "Watch your streak grow", text: "Every finished session builds your streak and your stats." },
] as const;

const FAQ = [
  { q: "Which phones does FocusX work on?", a: "Any Android phone running Android 8.0 or newer." },
  { q: "Why does it ask for the Accessibility permission?", a: "Android only lets an app notice which app is open, and close a blocked one, through Accessibility. FocusX uses it only to block the apps you chose while a session runs. It does not read your messages or what you type." },
  { q: "Can I block only Reels and Shorts, not the whole app?", a: "Yes. You can block just the Shorts and Reels feeds and keep the rest of the app for studying." },
  { q: "What happens after the free trial?", a: "You get 3 days free. After that the plan you chose renews monthly through Razorpay (UPI, card or net banking). Cancel any time inside the app and you are not charged again." },
  { q: "Is it only for JEE and NEET students?", a: "No. FocusX is for any student who wants fewer distractions, from school to college to exam prep." },
  { q: "Can my parent keep an eye on me?", a: "Yes. With the Parent plan, a parent can add up to 3 children, pause or monitor them, and keep FocusX from being uninstalled without the parent's code." },
];

export default async function Landing() {
  const price = await getServices().repos.planPrices.get();
  const email = contactEmail();

  return (
    <div className="lp">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap" />

      <header className="lp-header">
        <Link href="/" className="lp-brand">
          <span className="lp-logo"><Bolt /></span>
          <span className="lp-brand-name">Focus<span style={{ color: "#c8f560" }}>X</span></span>
        </Link>
        <nav className="lp-nav" aria-label="Main">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href={PLAY_URL} className="lp-cta-sm">Get the app</a>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-tags">
            <span className="lp-tag mint">Made for students</span>
            <span className="lp-tag pink">Android</span>
            <span className="lp-tag line">3 days free</span>
          </div>
          <h1 className="lp-h1">Study.<br /><span>Don&apos;t scroll.</span></h1>
          <p className="lp-lead">FocusX locks away the apps that steal your study time, kills Shorts and Reels, and gives you a timer, a planner and an AI buddy that keeps you going.</p>
          <div className="lp-hero-actions">
            <a href={PLAY_URL} className="lp-play">
              <PlayArrow />
              <span className="lp-play-text"><small>GET IT ON</small><b>Google Play</b></span>
            </a>
            <span className="lp-fine">Free for 3 days, then from ₹{price.student}/month</span>
          </div>
        </div>

        <div className="lp-hero-art" aria-hidden="true">
          <div className="lp-blob" />
          <div className="lp-phone">
            <div className="lp-phone-top"><b>FocusX</b><span className="lp-streak">12 day streak</span></div>
            <div className="lp-goal">
              <Bolt size={34} />
              <div><small>TODAY&apos;S GOAL</small><b>2h 30m of deep focus</b></div>
            </div>
            <div className="lp-start">Start focus</div>
            <div className="lp-buddy"><span>Buddy:</span> One more chapter and you have earned a break. You&apos;ve got this.</div>
            <div className="lp-tiles">
              <div className="lp-tile mint"><small>Focused</small><b>4h 10m</b></div>
              <div className="lp-tile dark"><small>Reels saved</small><b>1h 05m</b></div>
            </div>
          </div>
          <span className="lp-locked">Instagram is blocked</span>
        </div>
      </section>

      <div className="lp-stripe" aria-hidden="true">
        <div><span>BLOCK APPS</span><span>★</span><span>KILL REELS</span><span>★</span><span>BEAT THE SCROLL</span><span>★</span><span>STUDY MORE</span></div>
      </div>

      <section className="lp-problem">
        <h2 className="lp-h2 tight">Five more minutes turned into two hours.</h2>
        <p>You open your phone to check one thing. Then it is Reels, then Shorts, then midnight. Willpower alone loses to apps built by thousands of engineers. FocusX takes the choice away while you study, so the work actually gets done.</p>
      </section>

      <section id="features" className="lp-features">
        <h2 className="lp-h2">Everything you need to <span>actually focus</span>.</h2>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className={`lp-card ${f.tone}`}>
              <div className="lp-icon"><Icon d={f.d} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="lp-how">
        <div className="inner">
          <h2 className="lp-h2">Three steps. That&apos;s it.</h2>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="lp-step">
                <div className="lp-badge" style={{ background: s.color, color: "#0a1a12" }}>{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-block">
        <div className="lp-block-art" aria-hidden="true">
          <div className="lp-lock-phone">
            <div className="lp-lock-icon"><Bolt size={48} /></div>
            <div className="small">Instagram is blocked</div>
            <div className="title">Back to work.</div>
            <div className="time">18:42</div>
            <div className="btn">Keep focusing</div>
          </div>
        </div>
        <div className="lp-block-copy">
          <span className="lp-nope">Nice try.</span>
          <h2 className="lp-h2 tight">Open a blocked app and FocusX sends you back.</h2>
          <p>No guilt trips, no long lectures. A friendly screen shows how much time is left and brings you straight back to your session.</p>
        </div>
      </section>

      <section className="lp-privacy">
        <div className="band">
          <svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#8ff0b4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.3 8-8 9-4.7-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
          <div className="copy">
            <h2>Your phone, your privacy.</h2>
            <p>The Accessibility permission is used only to block the apps you pick during a session. FocusX never reads your messages, passwords or what you type. Read the <Link href="/privacy" style={{ color: "#c8f560" }}>privacy policy</Link>.</p>
          </div>
        </div>
      </section>

      <section id="pricing" className="lp-pricing">
        <h2 className="lp-h2">Pick a plan. <span>Try it free.</span></h2>
        <div className="lp-plans">
          <div className="lp-plan">
            <div className="lp-plan-head"><b>Student</b><span className="lp-free">3 days free</span></div>
            <div className="lp-price"><b>₹{price.student}</b> <span>/ month</span></div>
            {["Block any app, Shorts & Reels", "Focus timer + Pomodoro", "AI study buddy", "Full screen-time reports", "Planner with reminders"].map((t) => (
              <div key={t} className="lp-perk"><Tick />{t}</div>
            ))}
            <a href={PLAY_URL} className="lp-plan-cta">Start free trial</a>
            <small>Cancel any time in the app.</small>
          </div>
          <div className="lp-plan hot">
            <div className="lp-plan-head"><b>Parent</b><span className="lp-free">3 days free</span></div>
            <div className="lp-price"><b>₹{price.parent}</b> <span>/ month</span></div>
            {["Everything in Student", "Add up to 3 children", "Pause and monitor each child", "Child cannot uninstall without your code", "Children use your plan at no extra cost"].map((t) => (
              <div key={t} className="lp-perk"><Tick />{t}</div>
            ))}
            <a href={PLAY_URL} className="lp-plan-cta">Start free trial</a>
            <small>Cancel any time in the app.</small>
          </div>
        </div>
      </section>

      <section id="faq" className="lp-faq">
        <h2 className="lp-h2">Questions, answered.</h2>
        <div className="lp-faq-list">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}<span aria-hidden="true">+</span></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <div className="band">
          <h2>Your next 2 hours are yours.</h2>
          <a href={PLAY_URL}><PlayArrow color="#c8f560" size={24} />Get FocusX</a>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="inner">
          <div className="cols">
            <div className="about">
              <Link href="/" className="lp-brand">
                <span className="lp-logo sm"><Bolt size={20} /></span>
                <span className="lp-brand-name" style={{ fontSize: 20 }}>Focus<span style={{ color: "#c8f560" }}>X</span></span>
              </Link>
              <p>The study focus app for students who are done losing hours to the scroll.</p>
              <a href={PLAY_URL} className="lp-footer-play"><PlayArrow size={18} />Google Play</a>
            </div>
            <nav aria-label="Product">
              <div>PRODUCT</div>
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
            </nav>
            <nav aria-label="Legal">
              <div>LEGAL</div>
              <Link href="/privacy">Privacy policy</Link>
              <Link href="/terms">Terms of use</Link>
              <Link href="/delete-account">Delete account</Link>
              {email && <a href={`mailto:${email}`}>Contact us</a>}
            </nav>
          </div>
          <div className="legal">
            <span>© {new Date().getFullYear()} FocusX. All rights reserved.</span>
            <span>Made for students, with <em>focus</em>.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
