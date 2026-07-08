/**
 * Test stub for youtubei.js: its import attributes break the vitest-pool
 * bundler, and tests run with network disabled anyway — endpoints that touch
 * Innertube fall back (or 502) exactly as they would with YouTube down.
 */
export class Innertube {
  static create(): Promise<Innertube> {
    return Promise.reject(new Error('youtubei stubbed out in tests'));
  }
}
