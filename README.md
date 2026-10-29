# FocusX backend

Next.js 16 (App Router) + MySQL 8 with **plain SQL** (`mysql2`, no ORM). One project holds both the JSON API
the app talks to (`/v1/...`) and the admin panel (`/admin`).

## First-time setup

```powershell
cd "C:\Users\chand\Music\TechByteX\focus app\foues\backend"
npm install
Copy-Item .env.example .env.local     # then edit it (see below)
```

You need a MySQL 8 server and an empty database:

```sql
CREATE DATABASE foues CHARACTER SET utf8mb4;
```

Put its address in `.env.local` as `DATABASE_URL=mysql://user:password@127.0.0.1:3306/foues`, then:

```powershell
npm run db:migrate                                   # creates the tables (db/migrations/*.sql, safe to re-run)
npm run admin:create -- you@example.com "a long password"   # login for /admin
npm run db:seed                                      # optional: demo user 9999999999 on a trial
npm run dev -- -p 3100 -H 0.0.0.0                    # http://localhost:3100
```

`.env.local` for local work:

```
DATABASE_URL=mysql://root:password@127.0.0.1:3306/foues
AUTH_SECRET=any-random-32+-characters
ADMIN_SESSION_SECRET=another-random-32+-characters
SMS_PROVIDER=console
OTP_DEV_CODE=123456
```

With `SMS_PROVIDER=console` no SMS is sent: the code is printed in the server log, and with `OTP_DEV_CODE`
every login code is `123456`. Both are **refused in production** (the server will not start).
Without `DATABASE_URL` the API runs in memory (data lost on restart; the admin panel needs MySQL).

## Login (phone number + SMS code)

No Firebase, no passwords.

1. `POST /v1/auth/otp/request {phone}` texts a 6-digit code (valid 5 minutes, 1 per 30 s, 3 per 10 min per number).
2. `POST /v1/auth/otp/verify {phone, code}` returns a session token (90 days). Wrong codes are limited to 5 tries.
3. The app sends `Authorization: Bearer <token>`. Only the SHA-256 of the token is stored.
4. `POST /v1/auth/logout` ends one device; `DELETE /v1/users/me` erases the account and all its devices.

Real SMS uses **Fast2SMS** (paid, per message): set `SMS_PROVIDER=fast2sms` and `FAST2SMS_API_KEY=...`.
The sender calls Fast2SMS' `otp` route; it is unit-tested against a fake but has **not** been run against the real
service yet. Check your Fast2SMS account's OTP route/DLT requirements before launch.

## Endpoints

| Method | Path | Auth | What |
|---|---|---|---|
| GET | `/health` | no | status + database check |
| POST | `/v1/auth/otp/request` | no | send code |
| POST | `/v1/auth/otp/verify` | no | code -> token |
| POST | `/v1/auth/logout` | yes | sign this device out |
| POST / DELETE | `/v1/users/me` | yes | create/update profile · delete account |
| GET | `/v1/subscription` | yes | `none / trial / active / grace / expired` + `expiresAt`, `tier` (student / parent), `via`, `paused` |
| GET | `/v1/plans` | no | prices set in Admin › Plans (these are what Razorpay charges) |
| GET | `/v1/announcements?after=` | yes | admin messages for this account (the app shows them as notifications) |
| POST | `/v1/subscription/verify` | yes | `{productId, purchaseToken}`: checks the purchase with Google, stores it, acknowledges it |
| POST | `/v1/payments/subscribe` | yes | start a Razorpay checkout for a plan: `{tier}` |
| POST | `/v1/payments/verify` | yes | confirm the checkout result (signature checked, Razorpay asked) |
| POST | `/v1/payments/cancel` | yes | stop renewal; access stays until the paid period ends |
| POST | `/v1/payments/webhook` | Razorpay signature | renewals, failures, cancellations |
| GET / POST | `/v1/sync` | yes | cloud backup (sessions, planner, tags) |
| GET / POST | `/v1/parent/children` | parent | list children with study totals · add a child (max 3), returns the one-time sign-in code |
| PATCH / DELETE | `/v1/parent/children/:id` | parent | rename, pause/resume · remove |
| POST | `/v1/parent/children/:id/code` · `/unlock` | parent | new sign-in code (signs child out) · one-time uninstall code |
| POST | `/v1/child/redeem` | no | child types the parent's code, gets a session |
| POST | `/v1/child/unlock` | child | checks the parent's uninstall code |

| POST | `/v1/ai/chat` | yes + plan | Buddy reply. 402 without a plan, 429 over the daily limit |
| GET | `/v1/ai/nudge` | yes + plan | The Home one-liner (new line at most every 3 hours) |

## Landing page

`/` is the public landing page (`src/app/page.tsx`, styles in `src/app/landing/landing.css`). It shows the Student and Parent prices set in the admin panel, links to `/privacy`, `/terms` and `/delete-account`, and a contact link when `CONTACT_EMAIL` is set. The Play Store button points to `https://play.google.com/store/apps/details?id=com.techbytex.foues`; set `PLAY_STORE_URL` to override it. The admin panel stays at `/admin`.

## Admin panel

`http://localhost:3100/admin`: sign in with the email/password from `npm run admin:create`.
Dashboard counts (users, trial, active, grace, expired, backups), user search with paging, user detail
(counts only: never what someone studied), and "delete user". Sessions are a signed HttpOnly cookie;
login attempts are rate-limited.

## Commands

```powershell
npm test               # 181 Jest tests (no database needed)
npm run typecheck
npm run build
```

Run the real-MySQL tests against a **throwaway** database (they empty their tables):

```powershell
$env:DATABASE_URL="mysql://root@127.0.0.1:3307/foues"; npm run db:migrate
$env:TEST_DATABASE_URL="mysql://root@127.0.0.1:3307/foues"; npx jest tests/mysql.integration.test.ts
```

Use `npm run dev` (not `npm start`) locally: a production start enforces the production rules above.

## Deploying

Needs Node 22+, MySQL 8, HTTPS in front (a reverse proxy that sets `X-Forwarded-For`). Set `NODE_ENV=production`,
`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_SESSION_SECRET`, `SMS_PROVIDER=fast2sms`, `FAST2SMS_API_KEY`; run
`npm run build`, `npm run db:migrate`, `npm start`. `next.config.ts` builds a standalone server.

## Razorpay payments

The two plans (Student, Parent) are monthly Razorpay **Subscriptions** with a 3-day free trial for first-time subscribers.
The price is whatever is set in Admin > Plans; the first time a price is used FocusX creates the matching plan in Razorpay by itself.

1. Razorpay Dashboard: activate **Subscriptions**, then Account & Settings > API keys > generate a key (start with a **test** key `rzp_test_...`).
2. Open `/admin/payments`, paste the Key ID and Key Secret, save. They are encrypted with `AUTH_SECRET` before they reach the database
   (so keep `AUTH_SECRET` fixed: changing it makes saved keys unreadable and you would paste them again).
3. Razorpay Dashboard > Developers > Webhooks: add `https://<your-server>/v1/payments/webhook`, choose the events `subscription.*`,
   `payment.captured` and `payment.failed`, type a secret, and paste the same secret into **Webhook secret** on `/admin/payments`.
4. Try a test payment in the app (Razorpay's test UPI id `success@razorpay`, test cards in Razorpay's docs). When happy, save **live** keys.

`/admin/payments` also lists every payment (who, plan, amount, status, UPI/card, ids) and shows collected totals; a user's page lists their payments.
`PAY_MODE=fake` (dev only, refused in production) pretends the payment so the whole flow works without a Razorpay account.

Endpoints: `POST /v1/payments/subscribe`, `/verify`, `/cancel` (signed in) and `POST /v1/payments/webhook` (Razorpay's signature).

## Buddy (AI) setup

`AI_MODE=real`, `OPENAI_API_KEY` (from platform.openai.com; paid per use), `OPENAI_MODEL` (default `gpt-5-mini`),
`OPENAI_REASONING_EFFORT` (optional; gpt-5 models default to `minimal` for short, cheap replies), `AI_DAILY_LIMIT` (default 40).
Chats are not stored: the app sends the last 12 messages and three study numbers; the server adds the exam and forgets
the conversation. The persona and safety rules (stay on studying, Tele-MANAS 14416 for distress, no prompt leaks) are in
`src/server/ai/prompts.ts`. `AI_MODE=fake` is refused in production. The OpenAI call is tested against a mock only.
#   f o u e s a p b a c e k d n  
 