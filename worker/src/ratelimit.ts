/**
 * KV-backed fixed-window rate limit (~per minute, per IP). KV is eventually
 * consistent, so this is a soft cap against abuse, not a hard guarantee —
 * exactly what the free tier needs.
 */
export async function rateLimited(
  kv: KVNamespace,
  ip: string,
  limit = 60,
): Promise<boolean> {
  if (!ip) return false;
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${bucket}`;
  const count = Number((await kv.get(key).catch(() => null)) ?? 0) + 1;
  // waituntil-free best effort; expire after 2 windows
  await kv.put(key, String(count), { expirationTtl: 120 }).catch(() => {});
  return count > limit;
}
