/**
 * Google Play's reviewers cannot receive a WhatsApp or SMS code, so one number always accepts one fixed code.
 * It only gets an ordinary account (no extra rights) and it is the only number this applies to. Set REVIEW_LOGIN=off
 * on the server to switch it off once the app has been approved.
 */
export const REVIEW_PHONE = "+918827219873";
export const REVIEW_CODE = "123456";

/** The review account always has a running plan (renewed at every login), so a reviewer sees every feature without paying. */
export const REVIEW_PLAN_DAYS = 30;

export function isReviewLogin(phone: string, reviewLogin: "on" | "off"): boolean {
  return reviewLogin === "on" && phone === REVIEW_PHONE;
}
