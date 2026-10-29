/**
 * Buddy may only link to the apps the admin added. Anything else that looks like a link in a reply (the model made it up,
 * or a student talked it into it) is removed before the reply leaves the server.
 */
export function stripUnknownLinks(text: string, allowedUrls: string[]): string {
  const norm = (u: string) => {
    try {
      return new URL(u).toString();
    } catch {
      return u;
    }
  };
  const allowed = new Set(allowedUrls.map(norm));
  return text
    .replace(/https?:\/\/[^\s)>\]]+/gi, (match) => {
      const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
      const core = trailing ? match.slice(0, -trailing.length) : match;
      return allowed.has(norm(core)) ? match : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}
