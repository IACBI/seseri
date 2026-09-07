/**
 * The pairing code: 15 random bytes in Crockford base32, plus a check symbol.
 *
 * The code is the whole identity. There is no account, no password and no
 * server-side registration — everything is derived from these bytes
 * (`src/sync/crypto.ts`), so 120 bits of `getRandomValues` is the entire
 * security argument. Being open source does not weaken that: the scheme is
 * meant to be public, only the code is secret.
 *
 * Crockford rather than plain base32 because a human retypes this on a phone:
 * `I`, `L` and `O` fold onto `1` and `0`, case does not matter, and the
 * modulo-37 check symbol rejects any single mistyped character offline —
 * otherwise a typo reaches the server and comes back as a confusing 404.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford's five extra check values (32–36) on top of the 32 above. */
const CHECK_ALPHABET = ALPHABET + '*~$=U';

export const CODE_BYTES = 15;

/** 15 bytes is exactly 24 symbols, so nothing is padded. */
const DATA_SYMBOLS = 24;

/** Data symbols plus the trailing check symbol. */
export const CODE_LENGTH = DATA_SYMBOLS + 1;

const GROUP = 5;

function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >>> bits) & 31];
    }
  }
  return out;
}

function decodeBase32(symbols: string): Uint8Array | null {
  const out = new Uint8Array(CODE_BYTES);
  let acc = 0;
  let bits = 0;
  let i = 0;
  for (const ch of symbols) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (i >= CODE_BYTES) return null;
      out[i++] = (acc >>> bits) & 255;
    }
  }
  return i === CODE_BYTES ? out : null;
}

/** Modulo 37 over the big-endian value, byte by byte so no BigInt is needed. */
function checkSymbol(bytes: Uint8Array): string {
  let rem = 0;
  for (const b of bytes) rem = (rem * 256 + b) % 37;
  return CHECK_ALPHABET[rem] ?? '0';
}

export function encodeCode(bytes: Uint8Array): string {
  return encodeBase32(bytes) + checkSymbol(bytes);
}

export function generateCode(): string {
  return encodeCode(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
}

/** Group for display only. Never store or transmit the grouped form. */
export function formatCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP) groups.push(code.slice(i, i + GROUP));
  return groups.join('-');
}

/**
 * Parse whatever the user actually typed. Returns null for anything that is not
 * a well-formed code, including a single mistyped character.
 */
export function decodeCode(text: string): Uint8Array | null {
  const norm = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (norm.length !== CODE_LENGTH) return null;

  const data = norm.slice(0, DATA_SYMBOLS);
  const check = norm.slice(DATA_SYMBOLS);
  const bytes = decodeBase32(data);
  if (!bytes) return null;

  return checkSymbol(bytes) === check ? bytes : null;
}
