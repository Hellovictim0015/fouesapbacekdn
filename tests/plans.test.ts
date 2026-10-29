import { GET as getPlans } from "@/app/v1/plans/route";
import { setServicesForTests } from "@/server/container";
import { useServices } from "./helpers";

afterEach(() => setServicesForTests(undefined));

describe("GET /v1/plans", () => {
  it("is public and starts at Student 49, Parent 99", async () => {
    useServices();
    const res = await getPlans();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ student: { priceInr: 49 }, parent: { priceInr: 99 } });
  });

  it("shows whatever the admin saved", async () => {
    const h = useServices();
    await h.repos.planPrices.set({ student: 79, parent: 149 }, "admin@x");
    expect(await (await getPlans()).json()).toEqual({ student: { priceInr: 79 }, parent: { priceInr: 149 } });
  });
});
