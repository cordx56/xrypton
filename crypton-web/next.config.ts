import type { NextConfig } from "next";

if (!process.env.BACKEND_BASE_URL && !process.env.NEXT_PUBLIC_API_BASE_URL) {
  throw new Error(
    "Either BACKEND_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be set",
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const backendUrl = process.env.BACKEND_BASE_URL;
    if (!backendUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
