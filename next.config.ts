import type { NextConfig } from "next";
import { legacySlugRedirects } from "./src/lib/games/catalog";
import { locales } from "./src/lib/i18n/config";

const playRedirects = legacySlugRedirects().flatMap(({ from, to }) => [
  {
    source: `/play/${from}`,
    destination: `/play/${to}`,
    permanent: true,
  },
  ...locales.map((locale) => ({
    source: `/${locale}/play/${from}`,
    destination: `/${locale}/play/${to}`,
    permanent: true,
  })),
]);

const nextConfig: NextConfig = {
  // Telefondan http://192.168.x.x:3000 ile geliştirme
  allowedDevOrigins: ["192.168.211.31", "127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.md": {
        loaders: ["./md-loader.js"],
        as: "*.js",
      },
    },
  },
  async redirects() {
    return playRedirects;
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
