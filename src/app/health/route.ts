import { getServices } from "@/server/container";
import { json } from "@/server/http/respond";
import pkg from "../../../package.json";

/** Public liveness probe: the only route that needs no token. Also reports whether the database answers. */
export async function GET() {
  const database = (await getServices().ping()) ? "ok" : "down";
  return json({ status: database === "ok" ? "ok" : "degraded", version: pkg.version, uptimeSec: Math.round(process.uptime()), database }, database === "ok" ? 200 : 503);
}
