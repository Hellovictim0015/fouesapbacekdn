import { GET, POST } from "@/app/v1/sync/route";
import { setServicesForTests } from "@/server/container";
import { backup, req, useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

const session = { startedAt: 1_760_000_000_000, endedAt: 1_760_000_900_000, mode: "Timer", subject: "Physics", plannedMin: 15, focusedMin: 15, completed: true, note: "" };

describe("/v1/sync", () => {
  it("is 404 until a backup exists", async () => {
    useServices();
    const res = await GET(req("/v1/sync", { token: "tok-alice" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("no_backup");
  });

  it("round-trips a backup exactly", async () => {
    useServices();
    const body = backup();
    const put = await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body }));
    expect(put.status).toBe(200);
    expect((await put.json()).sessions).toBe(1);

    const got = await (await GET(req("/v1/sync", { token: "tok-alice" }))).json();
    expect(got.payload).toEqual(body);
    expect(typeof got.updatedAt).toBe("string");
  });

  it("works for a user who never called /users/me, and a second backup replaces the first", async () => {
    useServices();
    await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body: backup() }));
    await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body: backup({ sessions: [], tags: ["Maths"] }) }));
    const got = await (await GET(req("/v1/sync", { token: "tok-alice" }))).json();
    expect(got.payload.sessions).toEqual([]);
    expect(got.payload.tags).toEqual(["Maths"]);
  });

  it("keeps every user's backup private", async () => {
    useServices();
    await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body: backup({ tags: ["Alice only"] }) }));
    expect((await GET(req("/v1/sync", { token: "tok-bob" }))).status).toBe(404);
    await POST(req("/v1/sync", { method: "POST", token: "tok-bob", body: backup({ tags: ["Bob only"] }) }));
    expect((await (await GET(req("/v1/sync", { token: "tok-alice" }))).json()).payload.tags).toEqual(["Alice only"]);
  });

  it.each([
    ["wrong schema version", backup({ schemaVersion: 2 })],
    ["unknown mode", backup({ sessions: [{ ...session, mode: "Marathon" }] })],
    ["negative minutes", backup({ sessions: [{ ...session, focusedMin: -3 }] })],
    ["bad weekday mask", backup({ planned: [{ startMinute: 10, subject: "x", durationMin: 30, repeatType: "WEEKLY", daysMask: 999, accent: "Lime" }] })],
    ["too many tags", backup({ tags: Array.from({ length: 60 }, (_, i) => `t${i}`) })],
    ["missing sessions", { schemaVersion: 1, planned: [], tags: [] }],
  ])("rejects %s with 400", async (_name, body) => {
    useServices();
    const res = await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body }));
    expect(res.status).toBe(400);
  });

  it("accepts a large backup but rejects one over 5 MB with 413", async () => {
    useServices();
    const big = backup({ sessions: Array.from({ length: 5_000 }, () => session) });
    expect((await POST(req("/v1/sync", { method: "POST", token: "tok-alice", body: big }))).status).toBe(200);

    const huge = JSON.stringify({ ...backup({ sessions: [], tags: [] }), pad: "x".repeat(5 * 1024 * 1024) });
    expect((await POST(req("/v1/sync", { method: "POST", token: "tok-alice", rawBody: huge }))).status).toBe(413);
  });
});
