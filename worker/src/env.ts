import type { RateLimiterDO } from './ratelimit';

/**
 * Workers Rate Limiting binding.
 *
 * Declared here rather than pulled from generated runtime types so the strict
 * build does not depend on a `wrangler types` step nobody runs.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  /** Where every budget is actually counted (see ratelimit.ts). */
  LIMITERS: DurableObjectNamespace<RateLimiterDO>;
  /** Fallback for the proxy budget, used only when the object is unreachable. */
  PROXY_IP: RateLimiter;
  /** Fallback for sync's per-client budget. */
  SYNC_IP: RateLimiter;
  /** Fallback for sync's per-code budget: one leaked code, one budget. */
  SYNC_ID: RateLimiter;
  /** "1" makes every sync route answer 503 without a client deploy. */
  SYNC_DISABLED?: string;
}

export type AppContext = { Bindings: Env };
