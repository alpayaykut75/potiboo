/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vitest/config";
import path from "path";

function mdAsString(): Plugin {
  return {
    name: "md-as-string",
    transform(code, id) {
      if (!id.endsWith(".md")) return null;
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [mdAsString()],
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
