import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { afterEach } from 'vitest';
import type { D1Migration } from 'cloudflare:test';
import type { RateLimiter } from '../src/env';
import type { RateLimiterDO } from '../src/ratelimit';

/**
 * The sync tests run against a real local D1, not a fake, so the schema has to
 * exist before any of them do. This augmentation is the single place the test
 * bindings are declared.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      LIMITERS: DurableObjectNamespace<RateLimiterDO>;
      PROXY_IP: RateLimiter;
      SYNC_IP: RateLimiter;
      SYNC_ID: RateLimiter;
      SYNC_DISABLED?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/**
 * Every test starts from empty storage — the edge cache above all, which the
 * proxy tests fill under the same URLs. The pool used to isolate storage per
 * test on its own; since 0.22 it isolates per file, and `reset()` is the
 * documented way back to per-test. It empties D1 too, so the schema goes back
 * on after it.
 */
afterEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
