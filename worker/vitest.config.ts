import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

import { fileURLToPath } from 'node:url';

export default defineWorkersConfig({
  resolve: {
    alias: {
      'youtubei.js': fileURLToPath(new URL('./test/stubs/youtubei.ts', import.meta.url)),
    },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
