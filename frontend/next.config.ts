import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Static export: the backend serves these files, so one process and one
  // address carry the whole app (see Dockerfile and backend/main.py).
  output: "export",
};

export default nextConfig;
