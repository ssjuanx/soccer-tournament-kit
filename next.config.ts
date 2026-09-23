import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep Turbopack scoped to this project so it does not pick up files
  // (e.g. a package-lock.json) from parent directories.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
