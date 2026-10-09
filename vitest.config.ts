import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          INGEST_TOKEN: "test-token-with-at-least-32-characters",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(directory, "migrations"),
          ),
        },
      },
      wrangler: {
        configPath: path.join(directory, "wrangler.jsonc"),
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
