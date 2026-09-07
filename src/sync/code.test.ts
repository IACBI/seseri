import { describe, expect, it } from 'vitest';
import { CODE_BYTES, decodeCode, encodeCode, formatCode, generateCode } from './code';

/**
 * The code is the entire identity — there is no account to fall back on — so
 * two things have to hold: the bytes really come from `getRandomValues`, and a
 * character mistyped on a phone keyboard fails here rather than reaching the
 * server and returning a 404 the user cannot interpret.
 */

const CANONICAL = /^[0-9A-HJKMNP-TV-Z]{24}[0-9A-HJKMNP-TV-Z*~$=U]$/;

function bytes(fill: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length: CODE_BYTES }, (_v, i) => fill(i));
}

/** A code that actually contains `ch`, so a substitution test cannot no-op. */
function codeContaining(ch: string): string {
  for (let seed = 0; seed < 64; seed++) {
    const code = encodeCode(bytes((i) => (i * 31 + seed) & 255));
    if (code.includes(ch)) return code;
  }
  throw new Error('no code containing ' + ch);
}

describe('generateCode', () => {
  it('produces 24 Crockford symbols followed by a check symbol', () => {
    expect(generateCode()).toMatch(CANONICAL);
  });

  it('produces 100 distinct codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateCode()));

    expect(codes.size).toBe(100);
  });
});

describe('decodeCode', () => {
  it.each([
    ['all zero bytes', bytes(() => 0)],
    ['all 0xff bytes', bytes(() => 255)],
    ['ascending bytes', bytes((i) => i * 17)],
    ['descending bytes', bytes((i) => 255 - i * 9)],
    ['alternating bytes', bytes((i) => (i % 2 ? 0xa5 : 0x5a))],
  ])('round-trips %s', (_label, raw) => {
    expect(decodeCode(encodeCode(raw))).toEqual(raw);
  });

  it('accepts a code typed with spaces, hyphens and lowercase', () => {
    const code = encodeCode(bytes((i) => i * 13));

    const typed = formatCode(code).toLowerCase().replace('-', ' ');

    expect(decodeCode(typed)).toEqual(decodeCode(code));
  });

  it.each([
    ['O', '0'],
    ['I', '1'],
    ['L', '1'],
  ])('folds the ambiguous character %s onto %s', (typo, real) => {
    const code = codeContaining(real);

    const retyped = code.split(real).join(typo);

    // Without this the test passes vacuously on a code that never held the
    // character in the first place.
    expect(retyped).not.toBe(code);
    expect(decodeCode(retyped)).toEqual(decodeCode(code));
  });

  it.each([0, 5, 11, 17, 23])('rejects a code with the character at %i changed', (pos) => {
    const code = encodeCode(bytes((i) => i * 7 + 3));
    const cur = code[pos] as string;
    const replacement = cur === '0' ? '1' : '0';

    const typo = code.slice(0, pos) + replacement + code.slice(pos + 1);

    expect(decodeCode(typo)).toBeNull();
  });

  it('rejects a code whose check symbol was mistyped', () => {
    const code = encodeCode(bytes((i) => i * 7 + 3));
    const last = code[code.length - 1] as string;

    const typo = code.slice(0, -1) + (last === '0' ? '1' : '0');

    expect(decodeCode(typo)).toBeNull();
  });

  it.each([23, 24, 26])('rejects a code of length %i', (len) => {
    const code = encodeCode(bytes(() => 42));

    const wrong = len < code.length ? code.slice(0, len) : code + '7';

    expect(decodeCode(wrong)).toBeNull();
  });

  it('rejects a code containing a character outside the alphabet', () => {
    const code = encodeCode(bytes(() => 42));

    expect(decodeCode('!' + code.slice(1))).toBeNull();
  });
});

describe('formatCode', () => {
  it('groups the code into five blocks of five', () => {
    expect(formatCode(encodeCode(bytes(() => 42)))).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z*~$=U]{5}){4}$/,
    );
  });
});
