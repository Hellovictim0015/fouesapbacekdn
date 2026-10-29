import { nationalNumber } from "./phone";

/** Sends a login code to a phone. Swappable so tests and local dev cost nothing. */
export interface SmsSender {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

export class SmsSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsSendError";
  }
}

/** Prints the code in the server log instead of sending it. Development only (the environment refuses it in production). */
export function createConsoleSender(): SmsSender {
  return {
    async sendOtp(phone, code) {
      console.log(`[foues] login code for ${phone}: ${code}`);
    },
  };
}

/**
 * Fast2SMS "otp" route (https://docs.fast2sms.com). The API key goes in the `authorization` header and
 * the code in `variables_values`. The key is never logged.
 */
export function createFast2SmsSender(apiKey: string, fetchImpl: typeof fetch = fetch): SmsSender {
  return {
    async sendOtp(phone, code) {
      let res: Response;
      try {
        res = await fetchImpl("https://www.fast2sms.com/dev/bulkV2", {
          method: "POST",
          headers: { authorization: apiKey, "content-type": "application/json" },
          body: JSON.stringify({ route: "otp", variables_values: code, numbers: nationalNumber(phone) }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SmsSendError("SMS gateway is unreachable");
      }
      const body = (await res.json().catch(() => null)) as { return?: boolean } | null;
      if (!res.ok || body?.return !== true) {
        throw new SmsSendError(`SMS gateway refused the message (HTTP ${res.status})`);
      }
    },
  };
}

/**
 * Fast2SMS WhatsApp route: sends the approved "otp" template through WhatsApp. The key and template id go in the
 * query string exactly as Fast2SMS documents it, so this URL must never be logged. `variables_values` holds the
 * template variables separated by "|": our template has one, the code.
 */
export function createFast2SmsWhatsAppSender(apiKey: string, messageId: string, fetchImpl: typeof fetch = fetch): SmsSender {
  return {
    async sendOtp(phone, code) {
      const url = new URL("https://www.fast2sms.com/dev/whatsapp");
      url.search = new URLSearchParams({
        authorization: apiKey,
        message_id: messageId,
        numbers: nationalNumber(phone),
        variables_values: code,
      }).toString();
      let res: Response;
      try {
        res = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new SmsSendError("WhatsApp gateway is unreachable");
      }
      const body = (await res.json().catch(() => null)) as { return?: boolean } | null;
      if (!res.ok || body?.return === false) throw new SmsSendError(`WhatsApp gateway refused the message (HTTP ${res.status})`);
    },
  };
}
