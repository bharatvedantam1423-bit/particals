import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three ships ESM; transpiling keeps the worker bundle and the page bundle on one copy.
  transpilePackages: ["three"],
};

export default nextConfig;
