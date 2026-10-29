import mysql from "mysql2/promise";

const g = globalThis as unknown as { __fouesPool?: mysql.Pool };

/**
 * One connection pool per process (kept on globalThis so Next's dev hot-reload does not open a new
 * pool on every edit). Dates are read and written as UTC.
 */
export function getPool(databaseUrl: string): mysql.Pool {
  return (g.__fouesPool ??= mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
    charset: "utf8mb4",
    supportBigNumbers: true,
  }));
}
