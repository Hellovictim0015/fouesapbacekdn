// Local-dev seed: one demo user (phone 9999999999) on a 3-day trial; log in with OTP_DEV_CODE.
// on a 3-day trial. Usage: npm run db:seed
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
try {
  const userId = randomUUID();
  await conn.execute(
    `INSERT INTO users (id, auth_uid, phone, name, exam, daily_goal_min, created_at, updated_at)
     VALUES (?, 'ph:+919999999999', '+919999999999', 'Demo Student', 'JEE', 240, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE name = name`,
    [userId],
  );
  const [[user]] = await conn.execute("SELECT id FROM users WHERE auth_uid = 'ph:+919999999999'");
  await conn.execute(
    `INSERT INTO subscriptions (id, user_id, product_id, purchase_token, status, expires_at, auto_renewing, acknowledged, created_at, updated_at)
     VALUES (?, ?, 'focus_student', 'dev-token-trial', 'TRIAL', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 3 DAY), 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 3 DAY), status = 'TRIAL', updated_at = UTC_TIMESTAMP(3)`,
    [randomUUID(), user.id],
  );
  console.log("seeded demo user 9999999999 with a 3-day trial");
} finally {
  await conn.end();
}
