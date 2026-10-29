import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smallest possible production image (see Dockerfile).
  output: "standalone",
  poweredByHeader: false,
  // Native/Node-only packages must not be bundled into route code.
  serverExternalPackages: ["mysql2", "bcryptjs"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
