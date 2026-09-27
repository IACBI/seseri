import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * `readD1Migrations` runs in Node, here; `applyD1Migrations` runs inside the
 * worker isolate, in the setup file. The migrations travel between them as an
 * ordinary binding, which is why they are handed over as `TEST_MIGRATIONS`.
 */
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
        // `ratelimits` comes from wrangler.jsonc now. Pool 0.8 ignored that
        // field and needed a copy here; 0.22 reads it, and rejects the copy.
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
}));
