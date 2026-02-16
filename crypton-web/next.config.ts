import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";
import path from "path";

if (!process.env.BACKEND_BASE_URL && !process.env.NEXT_PUBLIC_API_BASE_URL) {
  throw new Error(
    "Either BACKEND_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be set",
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  webpack: (config) => {
    config.resolve.alias["@docs"] = path.resolve(
      process.cwd(),
      "..",
      "crypton-docs",
    );
    return config;
  },
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

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: { remarkPlugins: [remarkGfm] },
});

export default withMDX(nextConfig);
