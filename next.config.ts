import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Telefondan http://192.168.x.x:3000 ile geliştirme
  allowedDevOrigins: ["192.168.211.31", "127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
