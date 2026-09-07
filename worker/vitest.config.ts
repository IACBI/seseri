import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/**
 * `readD1Migrations` runs in Node, here; `applyD1Migrations` runs inside the
 * worker isolate, in the setup file. The migrations travel between them as an
 * ordinary binding, which is why they are handed over as `TEST_MIGRATIONS`.
 */
export default defineWorkersConfig(async () => ({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
          // The pool does not translate wrangler.jsonc's `ratelimits` into
          // bindings — without this the limiters arrive as undefined and every
          // sync request 500s. Keep the numbers in step with wrangler.jsonc.
          ratelimits: {
            SYNC_IP: { simple: { limit: 60, period: 60 } },
            SYNC_ID: { simple: { limit: 120, period: 60 } },
          },
        },
      },
    },
  },
}));
