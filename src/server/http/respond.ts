import { ZodError, type ZodType } from "zod";
import type { AuthUser } from "../auth/types";
import { getServices } from "../container";

/** Throw from a handler to send a specific status and a machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return json({ error: { code: e.code, message: e.message } }, e.status, e.headers);
  }
  if (e instanceof ZodError) {
    return json({ error: { code: "invalid_request", message: "Invalid request", issues: e.issues } }, 400);
  }
  console.error("[foues] unhandled error", e);
  return json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

/** Wraps a route body so every failure becomes a JSON error and nothing internal leaks. */
export async function handle(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Reads and validates a JSON body. Next.js does not cap request bodies for route handlers, so the
 * size limit is enforced here, before parsing.
 */
export async function readBody<T>(req: Request, schema: ZodType<T>, maxBytes = 100 * 1024): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "too_large", "Request body is too large");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, "too_large", "Request body is too large");
  let data: unknown;
  try {
    data = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Body is not valid JSON");
  }
  return schema.parse(data);
}

export function bearerToken(req: Request): string | null {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
}

/** The caller's address as the reverse proxy reports it (used only to limit abuse, never as identity). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Who is calling: checks `Authorization: Bearer <session token>`, then applies the per-user
 * request limit. Every /v1 route except /health starts with this.
 */
export async function authenticate(req: Request): Promise<AuthUser> {
  const { verifier, limiter, env } = getServices();
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "unauthorized", "Missing bearer token");

  let user: AuthUser;
  try {
    user = await verifier.verify(token);
  } catch {
    throw new HttpError(401, "invalid_token", "Invalid or expired token");
  }

  const r = await limiter.hit(`u:${user.uid}`, env.RATE_LIMIT_PER_MIN, 60);
  if (!r.allowed) {
    throw new HttpError(429, "rate_limited", "Too many requests, slow down", { "Retry-After": String(r.retryAfterSec) });
  }
  return user;
}
