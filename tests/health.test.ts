import { GET } from "@/app/health/route";
import { setServicesForTests } from "@/server/container";
import { useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

describe("GET /health", () => {
  it("needs no token and reports the version", async () => {
    useServices();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
    expect(typeof body.version).toBe("string");
  });

  it("returns 503 when the database does not answer", async () => {
    const h = useServices();
    h.services.ping = async () => false;
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).database).toBe("down");
  });
});
