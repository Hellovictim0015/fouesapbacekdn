import { DELETE, POST } from "@/app/v1/users/me/route";
import { setServicesForTests } from "@/server/container";
import { req, useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

describe("POST /v1/users/me", () => {
  it("creates the user from the token on first call", async () => {
    useServices();
    const res = await POST(
      req("/v1/users/me", { method: "POST", token: "tok-alice", body: { name: "Alice Kumar", exam: "JEE", dailyGoalMin: 300 } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Alice Kumar", exam: "JEE", dailyGoalMin: 300 });
  });

  it("uses sensible defaults and tolerates an empty body", async () => {
    useServices();
    const res = await POST(req("/v1/users/me", { method: "POST", token: "tok-bob" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: null, exam: null, dailyGoalMin: 240 });
  });

  it("a repeat call changes only the fields that were sent", async () => {
    useServices();
    await POST(req("/v1/users/me", { method: "POST", token: "tok-alice", body: { name: "Alice Kumar", exam: "JEE", dailyGoalMin: 300 } }));
    const res = await POST(req("/v1/users/me", { method: "POST", token: "tok-alice", body: { exam: "NEET" } }));
    expect(await res.json()).toMatchObject({ name: "Alice Kumar", exam: "NEET", dailyGoalMin: 300 });
  });

  it.each([
    [{ exam: "MBA" }],
    [{ dailyGoalMin: 5 }],
    [{ dailyGoalMin: 1000 }],
    [{ dailyGoalMin: 90.5 }],
    [{ name: "" }],
    [{ name: "x".repeat(61) }],
    [{ isAdmin: true }], // unknown fields are rejected, not ignored
  ])("rejects invalid input %j with 400", async (body) => {
    useServices();
    const res = await POST(req("/v1/users/me", { method: "POST", token: "tok-alice", body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    useServices();
    expect((await POST(req("/v1/users/me", { method: "POST", token: "tok-alice", rawBody: "{bad" }))).status).toBe(400);
    const big = JSON.stringify({ name: "x".repeat(200_000) });
    expect((await POST(req("/v1/users/me", { method: "POST", token: "tok-alice", rawBody: big }))).status).toBe(413);
  });
});

describe("DELETE /v1/users/me", () => {
  it("removes the user's data", async () => {
    const h = useServices();
    await POST(req("/v1/users/me", { method: "POST", token: "tok-alice" }));
    const res = await DELETE(req("/v1/users/me", { method: "DELETE", token: "tok-alice" }));
    expect(res.status).toBe(200);
    expect(await h.repos.users.findByAuthUid("alice")).toBeNull();
  });

  it("is harmless when there is nothing to delete", async () => {
    useServices();
    expect((await DELETE(req("/v1/users/me", { method: "DELETE", token: "tok-ghost" }))).status).toBe(200);
  });
});
