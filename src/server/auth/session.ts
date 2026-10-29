import { hashToken } from "./otp";
import { InvalidTokenError, type TokenVerifier } from "./types";
import type { AuthRepo } from "../repos/types";

/** Checks the bearer token the app got at login against the `auth_sessions` table. */
export function createSessionVerifier(auth: AuthRepo): TokenVerifier {
  return {
    async verify(token) {
      const owner = await auth.findSession(hashToken(token));
      if (!owner) throw new InvalidTokenError();
      return { uid: owner.authUid, phone: owner.phone ?? undefined };
    },
  };
}
