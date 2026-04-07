import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/constants"],
};

export default nextConfig;
