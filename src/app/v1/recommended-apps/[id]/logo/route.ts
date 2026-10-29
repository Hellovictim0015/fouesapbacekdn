import { getServices } from "@/server/container";

/** GET /v1/recommended-apps/:id/logo (public): the logo image the admin uploaded. Cached for a day; the URL carries ?v= so edits show up. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  const logo = Number.isInteger(n) && n > 0 ? await getServices().repos.recommendedApps.getLogo(n) : null;
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
