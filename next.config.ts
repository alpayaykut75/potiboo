import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Telefondan http://192.168.x.x:3000 ile geliştirme
  allowedDevOrigins: ["192.168.211.31", "127.0.0.1", "localhost"],
};

export default nextConfig;
