// Creates (or resets the password of) an admin-panel login.
// Usage: npm run admin:create -- you@example.com "a long password"
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const [email, password] = process.argv.slice(2);
if (!email || !password || !email.includes("@")) {
  console.error('Usage: npm run admin:create -- you@example.com "a long password"');
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
try {
  await conn.execute(
    `INSERT INTO admins (id, email, password_hash, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [randomUUID(), email.trim().toLowerCase(), hash],
  );
  console.log(`admin ready: ${email.trim().toLowerCase()}`);
} finally {
  await conn.end();
}
