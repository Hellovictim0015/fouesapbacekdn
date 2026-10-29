import { hashToken } from "@/server/auth/otp";
import { getServices } from "@/server/container";
import { authenticate, bearerToken, handle, json } from "@/server/http/respond";

/** POST /v1/auth/logout: signs this device out (the token stops working at once). */
export function POST(req: Request) {
  return handle(async () => {
    await authenticate(req);
    await getServices().repos.auth.deleteSession(hashToken(bearerToken(req)!));
    return json({ loggedOut: true });
  });
}
