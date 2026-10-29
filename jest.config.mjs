import nextJest from "next/jest.js";

// next/jest compiles TypeScript with SWC and understands the "@/..." path alias from tsconfig.
const createJestConfig = nextJest({ dir: "./" });

const config = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};

// `jose` ships only as an ES module, so Jest must compile it too. next/jest sets its own
// transformIgnorePatterns, so the exception is added after it has built the config.
export default async () => {
  const resolved = await createJestConfig(config)();
  resolved.transformIgnorePatterns = ["/node_modules/(?!(jose)/)", "^.+\.module\.(css|sass|scss)$"];
  return resolved;
};
