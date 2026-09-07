-- One row per pairing code. The worker never learns what is inside `blob`:
-- it is AES-GCM ciphertext whose key is derived from a code that only the
-- user's devices hold (see src/sync/crypto.ts in the app).
CREATE TABLE IF NOT EXISTS sync (
  id         TEXT    PRIMARY KEY,   -- base64url(HKDF(code, "seseri-sync-id-v1")), 43 chars
  rev        INTEGER NOT NULL,      -- monotonic compare-and-set token, surfaced as ETag
  blob       BLOB    NOT NULL,      -- version || iv(12) || ciphertext
  size       INTEGER NOT NULL,      -- so the retention sweep can report without reading blobs
  updated_at INTEGER NOT NULL       -- ms epoch, server clock
);

-- The only query that is not a primary-key lookup is the retention sweep.
CREATE INDEX IF NOT EXISTS sync_updated_at ON sync (updated_at);
