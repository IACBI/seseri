import { Hono } from 'hono';
import type { Env } from './env';

/**
 * Cross-device sync storage.
 *
 *   GET    /v1/sync   → the stored ciphertext, ETag: "<rev>"
 *   PUT    /v1/sync   → replace it, guarded by If-Match: "<rev>"
 *   DELETE /v1/sync   → forget it
 *
 * The worker is a dumb, authenticated-by-possession blob store: it never sees
 * the pairing code, never sees plaintext, and cannot enumerate anything. There
 * is deliberately no "create a code" endpoint — a code exists client-side the
 * moment it is generated, and the server first hears about it on the first PUT.
 *
 * `If-Match` is not decoration. Without compare-and-set, two devices that both
 * pull rev 5 and both push would have the second write silently discard the
 * first one's entries: no error, no conflict, just lost listening history.
 */

const MAX_BLOB_BYTES = 128 * 1024;

/** base64url of the 32-byte HKDF output. */
const SYNC_ID = /^[A-Za-z0-9_-]{43}$/;

/** A row nobody has touched in this long is an abandoned pairing. */
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

const RATE_LIMITED = { error: 'rate limited' } as const;

type SyncApp = { Bindings: Env; Variables: { syncId: string } };

function headers(extra: Record<string, string> = {}): Record<string, string> {
  // Every device needs the server clock to correct its own; the blob itself
  // must never reach the shared edge cache.
  return { 'cache-control': 'no-store', 'x-sync-time': String(Date.now()), ...extra };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `"0"` means create. Rejects `*`, empty and anything non-numeric. */
function parseRev(raw: string): number | null {
  const m = /^"?(\d{1,15})"?$/.exec(raw.trim());
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** D1 hands BLOB columns back as an ArrayBuffer; be tolerant of a plain array. */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array(0);
}

export const syncRoutes = new Hono<SyncApp>();

syncRoutes.use('*', async (c, next) => {
  // Kill switch first: a disabled deployment must answer even a malformed
  // request the same way, and must not touch D1 or the limiters.
  if (c.env.SYNC_DISABLED === '1') return c.json({ error: 'sync disabled' }, 503, headers());

  const id = c.req.header('x-sync-id') ?? '';
  if (!SYNC_ID.test(id)) return c.json({ error: 'bad sync id' }, 400, headers());

  const ip = c.req.header('cf-connecting-ip') ?? '';
  if (ip && !(await c.env.SYNC_IP.limit({ key: ip })).success) {
    return c.json(RATE_LIMITED, 429, headers({ 'retry-after': '60' }));
  }
  // Hashed, never raw: the limiter key is one more place the id would sit, and
  // the id is the bearer token for the whole row.
  if (!(await c.env.SYNC_ID.limit({ key: await sha256Hex(id) })).success) {
    return c.json(RATE_LIMITED, 429, headers({ 'retry-after': '60' }));
  }

  c.set('syncId', id);
  await next();
});

async function currentRow(
  env: Env,
  id: string,
): Promise<{ rev: number; blob: Uint8Array } | null> {
  const row = await env.DB.prepare('SELECT rev, blob FROM sync WHERE id = ?')
    .bind(id)
    .first<{ rev: number; blob: unknown }>();
  return row ? { rev: row.rev, blob: toBytes(row.blob) } : null;
}

function blobResponse(bytes: Uint8Array, rev: number, status: 200 | 409): Response {
  return new Response(bytes as unknown as BodyInit, {
    status,
    headers: headers({
      'content-type': 'application/octet-stream',
      etag: '"' + rev + '"',
      ...(status === 409 ? { 'x-sync-conflict': '1' } : {}),
    }),
  });
}

syncRoutes.get('/', async (c) => {
  const row = await currentRow(c.env, c.get('syncId'));
  // Not an error: a freshly paired device asks before anything has been pushed.
  if (!row) return c.json({ error: 'no sync data' }, 404, headers());
  return blobResponse(row.blob, row.rev, 200);
});

syncRoutes.put('/', async (c) => {
  const id = c.get('syncId');

  const ct = (c.req.header('content-type') ?? '').toLowerCase();
  if (!ct.startsWith('application/octet-stream')) {
    return c.json({ error: 'unsupported media type' }, 415, headers());
  }

  // Cheap reject on the declared size, then again on what actually arrived —
  // content-length can be absent or a lie.
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BLOB_BYTES) {
    return c.json({ error: 'payload too large' }, 413, headers());
  }

  const rev = parseRev(c.req.header('if-match') ?? '');
  if (rev === null) return c.json({ error: 'bad if-match' }, 400, headers());

  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength === 0) return c.json({ error: 'empty payload' }, 400, headers());
  if (body.byteLength > MAX_BLOB_BYTES) {
    return c.json({ error: 'payload too large' }, 413, headers());
  }

  const now = Date.now();
  const write =
    rev === 0
      ? c.env.DB.prepare(
          'INSERT INTO sync (id, rev, blob, size, updated_at) VALUES (?, 1, ?, ?, ?) ' +
            'ON CONFLICT(id) DO NOTHING',
        ).bind(id, body, body.byteLength, now)
      : c.env.DB.prepare(
          'UPDATE sync SET blob = ?, size = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?',
        ).bind(body, body.byteLength, now, id, rev);

  const res = await write.run();
  if ((res.meta.changes ?? 0) === 0) {
    // Somebody else wrote first. Hand back the winning blob so the client can
    // merge and retry in one more round trip instead of two.
    const row = await currentRow(c.env, id);
    if (!row) return c.json({ error: 'bad if-match' }, 400, headers());
    return blobResponse(row.blob, row.rev, 409);
  }

  return c.body(null, 204, headers({ etag: '"' + (rev === 0 ? 1 : rev + 1) + '"' }));
});

syncRoutes.delete('/', async (c) => {
  await c.env.DB.prepare('DELETE FROM sync WHERE id = ?').bind(c.get('syncId')).run();
  // Always 204, row or no row: a 404 here would tell a prober which ids exist.
  return c.body(null, 204, headers());
});

/** Daily cron. D1 has no TTL, and an abandoned pairing would sit there forever. */
export async function sweepSync(db: D1Database, now: number = Date.now()): Promise<number> {
  const res = await db
    .prepare('DELETE FROM sync WHERE updated_at < ?')
    .bind(now - RETENTION_MS)
    .run();
  return res.meta.changes ?? 0;
}
