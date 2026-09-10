import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from 'cloudflare:test';
import type { RateLimiter } from '../src/env';
import type { RateLimiterDO } from '../src/ratelimit';

/**
 * The sync tests run against a real local D1, not a fake, so the schema has to
 * exist before any of them do. This augmentation is the single place the test
 * bindings are declared.
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    LIMITERS: DurableObjectNamespace<RateLimiterDO>;
    PROXY_IP: RateLimiter;
    SYNC_IP: RateLimiter;
    SYNC_ID: RateLimiter;
    SYNC_DISABLED?: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
