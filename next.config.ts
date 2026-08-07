import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pruned server output (just the traced node_modules subset + server.js) instead of the
  // full node_modules tree, so the Docker runtime image (Dockerfile) stays small.
  output: 'standalone',
};

export default nextConfig;
