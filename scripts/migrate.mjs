// Applies db/migrations/*.sql in order, once each. Usage: npm run db:migrate
// Reads DATABASE_URL from the environment (.env.local is loaded by the npm script).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (mysql://user:password@host:3306/database).");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

// multipleStatements lets one .sql file hold many CREATE TABLEs.
const conn = await mysql.createConnection({ uri: url, multipleStatements: true, timezone: "Z" });
try {
  // Two deploys starting together must not both run the same migration.
  const [[lock]] = await conn.query("SELECT GET_LOCK('foues_migrate', 60) AS got");
  if (lock.got !== 1) throw new Error("Could not get the migration lock within 60 s");

  await conn.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  );
  const [done] = await conn.query("SELECT name FROM schema_migrations");
  const applied = new Set(done.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`applying ${file} ...`);
    // MySQL DDL cannot be rolled back, so a half-applied file needs fixing by hand: keep files small.
    await conn.query(await readFile(path.join(dir, file), "utf8"));
    await conn.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP(3))", [file]);
    ran++;
  }
  console.log(ran === 0 ? "database is up to date" : `applied ${ran} migration(s)`);
  await conn.query("SELECT RELEASE_LOCK('foues_migrate')");
} finally {
  await conn.end();
}
