import { GET } from "@/app/v1/subscription/route";
import { POST as upsertUser } from "@/app/v1/users/me/route";
import { effectiveStatus, hasAccess } from "@/server/domain/subscriptionStatus";
import { setServicesForTests } from "@/server/container";
import { req, useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

const HOUR = 3_600_000;

async function userId(token: string) {
  const res = await upsertUser(req("/v1/users/me", { method: "POST", token }));
  return (await res.json()).id as string;
}

const status = async (token: string) => (await (await GET(req("/v1/subscription", { token }))).json()).status;

describe("GET /v1/subscription", () => {
  it("is 'none' for a user who never subscribed", async () => {
    useServices();
    const res = await GET(req("/v1/subscription", { token: "tok-alice" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "none", expiresAt: null });
  });

  it("reports a running trial with its end time", async () => {
    const h = useServices();
    const id = await userId("tok-alice");
    const end = new Date(Date.now() + 70 * HOUR);
    h.repos.setSubscription(id, { status: "TRIAL", expiresAt: end, autoRenewing: true });
    expect(await (await GET(req("/v1/subscription", { token: "tok-alice" }))).json()).toMatchObject({
      status: "trial",
      expiresAt: end.toISOString(),
    });
  });

  it("reports active and grace", async () => {
    const h = useServices();
    const a = await userId("tok-a");
    const g = await userId("tok-g");
    const end = new Date(Date.now() + 24 * HOUR);
    h.repos.setSubscription(a, { status: "ACTIVE", expiresAt: end, autoRenewing: true });
    h.repos.setSubscription(g, { status: "GRACE", expiresAt: end, autoRenewing: true });
    expect(await status("tok-a")).toBe("active");
    expect(await status("tok-g")).toBe("grace");
  });

  it("an active subscription whose end time has passed counts as expired", async () => {
    const h = useServices();
    const id = await userId("tok-alice");
    h.repos.setSubscription(id, { status: "ACTIVE", expiresAt: new Date(Date.now() - HOUR), autoRenewing: true });
    expect(await status("tok-alice")).toBe("expired");
  });

  it("users never see each other's subscription", async () => {
    const h = useServices();
    const alice = await userId("tok-alice");
    await userId("tok-bob");
    h.repos.setSubscription(alice, { status: "ACTIVE", expiresAt: new Date(Date.now() + HOUR), autoRenewing: true });
    expect(await status("tok-bob")).toBe("none");
  });
});

describe("effectiveStatus", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const later = new Date("2026-11-02T10:00:00Z");
  const earlier = new Date("2026-11-01T09:59:59Z");

  it("maps no subscription and NONE to none", () => {
    expect(effectiveStatus(null, now)).toEqual({ status: "none", expiresAt: null });
    expect(effectiveStatus({ status: "NONE", expiresAt: null, autoRenewing: false }, now).status).toBe("none");
  });

  it.each([
    ["TRIAL", "trial"],
    ["ACTIVE", "active"],
    ["GRACE", "grace"],
  ] as const)("%s in the future stays %s", (stored, shown) => {
    expect(effectiveStatus({ status: stored, expiresAt: later, autoRenewing: true }, now).status).toBe(shown);
  });

  it.each(["TRIAL", "ACTIVE", "GRACE"] as const)("%s whose end has passed becomes expired", (stored) => {
    expect(effectiveStatus({ status: stored, expiresAt: earlier, autoRenewing: true }, now).status).toBe("expired");
  });

  it("the end time itself counts as expired", () => {
    expect(effectiveStatus({ status: "ACTIVE", expiresAt: now, autoRenewing: true }, now).status).toBe("expired");
  });

  it("EXPIRED stays expired, and access follows the status", () => {
    expect(effectiveStatus({ status: "EXPIRED", expiresAt: later, autoRenewing: false }, now).status).toBe("expired");
    expect(hasAccess({ status: "trial", expiresAt: null })).toBe(true);
    expect(hasAccess({ status: "active", expiresAt: null })).toBe(true);
    expect(hasAccess({ status: "grace", expiresAt: null })).toBe(true);
    expect(hasAccess({ status: "expired", expiresAt: null })).toBe(false);
    expect(hasAccess({ status: "none", expiresAt: null })).toBe(false);
  });
});
