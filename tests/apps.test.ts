import { POST as aiChat } from "@/app/v1/ai/chat/route";
import { GET as getRecommendations } from "@/app/v1/recommendations/route";
import { GET as getLogo } from "@/app/v1/recommended-apps/[id]/logo/route";
import { cleanKeywords, fallbackKeywords, generateKeywords, parseKeywordInput } from "@/server/apps/keywords";
import { stripUnknownLinks } from "@/server/apps/links";
import { MAX_LOGO_BYTES, validateAppUrl, validateLogo } from "@/server/apps/logo";
import { appMatchesGoal, appsForGoal, normalizeText, suggestFor } from "@/server/apps/match";
import { AiError } from "@/server/ai/types";
import { createSessionVerifier } from "@/server/auth/session";
import { hashToken } from "@/server/auth/otp";
import { setServicesForTests } from "@/server/container";
import type { RecommendedApp } from "@/server/repos/types";
import { req, useServices as useFakeServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

const app = (id: number, name: string, keywords: string[], active = true): RecommendedApp => ({
  id, name, tagline: "t", url: `https://example.com/${id}`, keywords, active, hasLogo: false, updatedAt: new Date(),
});

describe("matching a student's goal to an app", () => {
  it("normalises spelling: case, punctuation and a trailing s", () => {
    expect(normalizeText("JEE-Mains, 2027!")).toBe("jee main 2027");
    expect(normalizeText("  NEET   UG ")).toBe("neet ug");
  });

  it("matches whole words only", () => {
    expect(appMatchesGoal(["gate"], "GATE 2027 CSE")).toBe(true);
    expect(appMatchesGoal(["gate"], "negate everything")).toBe(false);
    expect(appMatchesGoal(["jee main"], "jee mains 27")).toBe(true);
    expect(appMatchesGoal(["gate cse"], "gate")).toBe(true); // a short goal is found inside a longer keyword
    expect(appMatchesGoal(["psu exams"], "PSU")).toBe(true);
    expect(appMatchesGoal(["class 11 cbse"], "class 10 boards")).toBe(false);
    expect(appMatchesGoal(["gate"], "ga")).toBe(false); // too short to mean anything
  });

  it("an empty goal matches nothing, and Hindi text works", () => {
    expect(appMatchesGoal(["gate"], "")).toBe(false);
    expect(appMatchesGoal(["gate"], null)).toBe(false);
    expect(appMatchesGoal(["यूपीएससी"], "यूपीएससी की तैयारी")).toBe(true);
  });

  it("each student sees only their own exam's apps", () => {
    const apps = [
      app(1, "GATE app", ["gate"]),
      app(2, "JEE NEET app", ["jee", "neet"]),
      app(3, "General aptitude app", ["psu", "aptitude", "ssc"]),
    ];
    const names = (goal: string) => appsForGoal(apps, goal).map((a) => a.name);
    expect(names("GATE")).toEqual(["GATE app"]);
    expect(names("jee advanced")).toEqual(["JEE NEET app"]);
    expect(names("NEET UG")).toEqual(["JEE NEET app"]);
    expect(names("PSU exams")).toEqual(["General aptitude app"]);
    expect(names("class 10 boards")).toEqual([]);
  });

  it("hidden apps are never shown, and at most 3 come back", () => {
    const apps = [1, 2, 3, 4, 5].map((i) => app(i, `A${i}`, ["gate"], i !== 5));
    expect(appsForGoal(apps, "gate")).toHaveLength(3);
    expect(appsForGoal(apps, "gate").map((a) => a.id)).toEqual([4, 3, 2]); // newest first, the hidden one skipped
  });
});

describe("keywords", () => {
  it("cleans, lower-cases and de-duplicates", () => {
    expect(cleanKeywords(["GATE", " gate ", "G", "x".repeat(41), 5, "Jee  Main"])).toEqual(["gate", "jee main"]);
    expect(parseKeywordInput("gate, JEE main\nneet ,")).toEqual(["gate", "jee main", "neet"]);
  });

  it("uses the AI's list when it gives one", async () => {
    const ai = { complete: async () => 'Sure: ["GATE", "gate cse", "graduate aptitude test in engineering"]' };
    expect(await generateKeywords(ai, "GATE Pro", "mock tests")).toEqual(["gate", "gate cse", "graduate aptitude test in engineering"]);
  });

  it("falls back to words from the name when the AI is down, unreadable or not set up", async () => {
    const down = { complete: async () => { throw new AiError("down"); } };
    const junk = { complete: async () => "no list here" };
    for (const ai of [down, junk, null]) {
      expect(await generateKeywords(ai, "GATE Prep Pro", "Mock tests for the exam")).toEqual(expect.arrayContaining(["gate", "pro", "mock", "tests"]));
    }
    expect(fallbackKeywords("The App", "for the best exam")).toEqual([]);
  });
});

describe("logo and link validation", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(50)]);

  it("accepts PNG, JPEG and WebP by their real bytes", () => {
    expect(validateLogo(png)).toMatchObject({ type: "image/png" });
    expect(validateLogo(jpg)).toMatchObject({ type: "image/jpeg" });
    expect(validateLogo(webp)).toMatchObject({ type: "image/webp" });
  });

  it("refuses SVG, scripts renamed as images, and big files", () => {
    expect(validateLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe("bad_type");
    expect(validateLogo(Buffer.from("<html><script>x</script></html>"))).toBe("bad_type");
    expect(validateLogo(Buffer.alloc(MAX_LOGO_BYTES + 1, 1))).toBe("too_big");
    expect(validateLogo(Buffer.alloc(0))).toBe("bad_type");
  });

  it("only https links", () => {
    expect(validateAppUrl("https://play.google.com/store/apps/details?id=x")).toContain("https://play.google.com");
    expect(validateAppUrl("http://example.com")).toBeNull();
    expect(validateAppUrl("javascript:alert(1)")).toBeNull();
    expect(validateAppUrl("https://localhost")).toBeNull();
    expect(validateAppUrl("not a url")).toBeNull();
    expect(validateAppUrl("https://example.com/" + "a".repeat(500))).toBeNull();
  });
});

describe("stripUnknownLinks", () => {
  const allowed = ["https://example.com/1"];
  it("keeps the admin's link, with trailing punctuation", () => {
    expect(stripUnknownLinks("Try GATE Pro: https://example.com/1.", allowed)).toBe("Try GATE Pro: https://example.com/1.");
  });
  it("removes any other link", () => {
    expect(stripUnknownLinks("Visit https://evil.example/x or https://example.com/1 now", allowed)).toBe("Visit or https://example.com/1 now");
    expect(stripUnknownLinks("see (http://evil.example/x)", allowed)).toBe("see");
  });
  it("with no apps, every link goes", () => {
    expect(stripUnknownLinks("go to https://example.com/1", [])).toBe("go to");
  });
});

describe("recommendations and Buddy", () => {
  async function setup() {
    const h = useFakeServices({ RATE_LIMIT_PER_MIN: "1000" });
    h.services.verifier = createSessionVerifier(h.repos.auth);
    const tok = async (uid: string, prepGoal?: string) => {
      const user = await h.repos.users.upsertByAuthUid(uid, { prepGoal, role: "student" });
      const token = `token-${uid}`;
      await h.repos.auth.createSession(user.id, hashToken(token), new Date(Date.now() + 1e9));
      h.repos.setSubscription(user.id, { status: "TRIAL", expiresAt: new Date(Date.now() + 1e8), autoRenewing: true });
      return token;
    };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    await h.repos.recommendedApps.create({ name: "GATE Pro", tagline: "GATE mock tests", url: "https://example.com/gate", keywords: ["gate"], logo: { type: "image/png", bytes: png }, createdBy: "a" });
    await h.repos.recommendedApps.create({ name: "JEE NEET Pro", tagline: "JEE and NEET practice", url: "https://example.com/jn", keywords: ["jee", "neet"], createdBy: "a" });
    return { h, tok };
  }
  const recs = async (token: string) => (await (await getRecommendations(req("/v1/recommendations", { token }))).json()).apps;

  it("a GATE student sees only the GATE app, a JEE student only the JEE/NEET one", async () => {
    const { tok } = await setup();
    const gate = await recs(await tok("a", "GATE 2027"));
    expect(gate.map((x: { name: string }) => x.name)).toEqual(["GATE Pro"]);
    expect(gate[0].logoUrl).toMatch(/^\/v1\/recommended-apps\/1\/logo\?v=\d+$/);
    expect(gate[0]).toMatchObject({ url: "https://example.com/gate", tagline: "GATE mock tests" });
    expect((await recs(await tok("b", "JEE Mains"))).map((x: { name: string }) => x.name)).toEqual(["JEE NEET Pro"]);
    expect(await recs(await tok("c", "UPSC"))).toEqual([]);
    expect(await recs(await tok("d"))).toEqual([]); // typed nothing
  });

  it("needs sign-in", async () => {
    await setup();
    expect((await getRecommendations(req("/v1/recommendations"))).status).toBe(401);
  });

  it("serves the logo with safe headers, and 404 for none", async () => {
    await setup();
    const ok = await getLogo(req("/x"), { params: Promise.resolve({ id: "1" }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await getLogo(req("/x"), { params: Promise.resolve({ id: "2" }) })).status).toBe(404);
    expect((await getLogo(req("/x"), { params: Promise.resolve({ id: "abc" }) })).status).toBe(404);
  });

  it("Buddy is told about the student's app only, and cannot link anywhere else", async () => {
    const { h, tok } = await setup();
    const token = await tok("a", "GATE");
    let system = "";
    h.services.ai = {
      complete: async (sys) => {
        system = sys;
        return "Try GATE Pro https://example.com/gate and also https://evil.example/x";
      },
    };
    const res = await aiChat(req("/v1/ai/chat", { method: "POST", token, body: { messages: [{ role: "user", content: "where do I study?" }] } }));
    expect(system).toContain("GATE Pro");
    expect(system).toContain("https://example.com/gate");
    expect(system).not.toContain("JEE NEET Pro");
    const reply = (await res.json()).reply as string;
    expect(reply).toContain("https://example.com/gate");
    expect(reply).not.toContain("evil.example");
  });

  it("a student with no matching app gets no app section", async () => {
    const { h, tok } = await setup();
    const token = await tok("a", "UPSC");
    let system = "";
    h.services.ai = { complete: async (sys) => { system = sys; return "ok"; } };
    await aiChat(req("/v1/ai/chat", { method: "POST", token, body: { messages: [{ role: "user", content: "hi" }] } }));
    expect(system).not.toContain("Apps made for this student");
  });
});

describe("assigning apps to one student by hand", () => {
  const apps = [app(1, "GATE app", ["gate"]), app(2, "JEE NEET app", ["jee", "neet"]), app(3, "Hidden app", ["gate"], false)];

  it("assigned apps come first, then the ones that match, without duplicates", () => {
    const out = suggestFor(apps, [2], "GATE");
    expect(out.map((x) => [x.app.name, x.assigned])).toEqual([["JEE NEET app", true], ["GATE app", false]]);
    expect(suggestFor(apps, [1], "GATE").map((x) => [x.app.name, x.assigned])).toEqual([["GATE app", true]]);
  });

  it("works for a student who typed nothing, and never shows a hidden app", () => {
    expect(suggestFor(apps, [2], "").map((x) => x.app.name)).toEqual(["JEE NEET app"]);
    expect(suggestFor(apps, [3], "").map((x) => x.app.name)).toEqual([]);
    expect(suggestFor(apps, [], "").map((x) => x.app.name)).toEqual([]); // blank when nothing applies
  });

  it("respects the limit and ignores ids that no longer exist", () => {
    expect(suggestFor(apps, [99, 2], "GATE", 1).map((x) => x.app.name)).toEqual(["JEE NEET app"]);
  });

  it("the student's Home gets the assigned app even though their goal does not match", async () => {
    const h = useFakeServices({ RATE_LIMIT_PER_MIN: "1000" });
    h.services.verifier = createSessionVerifier(h.repos.auth);
    const user = await h.repos.users.upsertByAuthUid("u1", { prepGoal: "UPSC" });
    await h.repos.auth.createSession(user.id, hashToken("tok"), new Date(Date.now() + 1e9));
    const gate = await h.repos.recommendedApps.create({ name: "GATE Pro", tagline: "t", url: "https://example.com/g", keywords: ["gate"], createdBy: "a" });
    const get = async () => (await (await getRecommendations(req("/v1/recommendations", { token: "tok" }))).json()).apps.map((x: { name: string }) => x.name);
    expect(await get()).toEqual([]);
    await h.repos.recommendedApps.assign(user.id, gate.id, "admin@x");
    expect(await get()).toEqual(["GATE Pro"]);
    await h.repos.recommendedApps.unassign(user.id, gate.id);
    expect(await get()).toEqual([]);
    await h.repos.recommendedApps.assign(user.id, gate.id, "admin@x");
    await h.repos.recommendedApps.remove(gate.id); // deleting the app removes the assignment too
    expect(await get()).toEqual([]);
    expect((await h.repos.recommendedApps.assignedFor([user.id])).size).toBe(0);
  });
});
