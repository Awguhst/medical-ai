import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Self-contained server bundle for the Docker image (frontend/Dockerfile).
  output: "standalone",
};

export default nextConfig;
