import { GET as getAnnouncements } from "@/app/v1/announcements/route";
import { createSessionVerifier } from "@/server/auth/session";
import { setServicesForTests } from "@/server/container";
import { req, useServices as useFakeServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

async function setup() {
  const h = useFakeServices({ RATE_LIMIT_PER_MIN: "1000" });
  h.services.verifier = createSessionVerifier(h.repos.auth);
  const make = async (uid: string, role: "student" | "parent" | "child") => {
    const user = await h.repos.users.upsertByAuthUid(uid, { role });
    await h.repos.auth.createSession(user.id, `hash-${uid}`, new Date(Date.now() + 1e9));
    return user;
  };
  return { h, make };
}

// The real verifier hashes the token; build tokens whose hash matches what we stored.
import { hashToken } from "@/server/auth/otp";
async function tokenFor(h: Awaited<ReturnType<typeof setup>>["h"], uid: string, role: "student" | "parent" | "child") {
  const user = await h.repos.users.upsertByAuthUid(uid, { role });
  const token = `token-for-${uid}`;
  await h.repos.auth.createSession(user.id, hashToken(token), new Date(Date.now() + 1e9));
  return { user, token };
}

const get = (token: string | undefined, qs = "") => getAnnouncements(req(`/v1/announcements${qs}`, { token }));

describe("GET /v1/announcements", () => {
  it("requires sign-in", async () => {
    const { h } = await setup();
    expect((await get(undefined)).status).toBe(401);
    void h;
  });

  it("each person gets what is meant for them", async () => {
    const { h } = await setup();
    const student = await tokenFor(h, "s1", "student");
    const parent = await tokenFor(h, "p1", "parent");
    const child = await tokenFor(h, "c1", "child");
    const create = (audience: "all" | "students" | "parents" | "children" | "user", title: string, targetUserId?: string) =>
      h.repos.announcements.create({ title, body: "b", audience, targetUserId, createdBy: "admin@x" });
    await create("all", "everyone");
    await create("students", "students only");
    await create("parents", "parents only");
    await create("children", "children only");
    await create("user", "just the parent", parent.user.id);

    const titles = async (t: string) => (await (await get(t)).json()).announcements.map((a: { title: string }) => a.title);
    expect(await titles(student.token)).toEqual(["everyone", "students only"]);
    expect(await titles(parent.token)).toEqual(["everyone", "parents only", "just the parent"]);
    expect(await titles(child.token)).toEqual(["everyone", "children only"]);
  });

  it("after=<id> returns only newer messages, so each shows once", async () => {
    const { h } = await setup();
    const { token } = await tokenFor(h, "s1", "student");
    const a = await h.repos.announcements.create({ title: "one", body: "b", audience: "all", createdBy: "x" });
    const first = await (await get(token, "?after=0")).json();
    expect(first.announcements.map((x: { id: number }) => x.id)).toEqual([a.id]);
    expect((await (await get(token, `?after=${a.id}`)).json()).announcements).toEqual([]);
    const b = await h.repos.announcements.create({ title: "two", body: "b", audience: "all", createdBy: "x" });
    expect((await (await get(token, `?after=${a.id}`)).json()).announcements.map((x: { id: number }) => x.id)).toEqual([b.id]);
  });

  it("returns at most 5 at a time and rejects a bad cursor", async () => {
    const { h } = await setup();
    const { token } = await tokenFor(h, "s1", "student");
    for (let i = 0; i < 8; i++) await h.repos.announcements.create({ title: `m${i}`, body: "b", audience: "all", createdBy: "x" });
    expect((await (await get(token)).json()).announcements).toHaveLength(5);
    expect((await get(token, "?after=abc")).status).toBe(400);
    expect((await get(token, "?after=-1")).status).toBe(400);
  });
});
