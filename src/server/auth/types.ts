/** Who is calling, as proven by their session token. */
export interface AuthUser {
  /** Stable id for this person ("ph:+91XXXXXXXXXX" for phone login). */
  uid: string;
  phone?: string;
}

export interface TokenVerifier {
  /** Resolves with the user, or rejects with [InvalidTokenError]. */
  verify(token: string): Promise<AuthUser>;
}

export class InvalidTokenError extends Error {
  constructor(message = 'Invalid or expired token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}
