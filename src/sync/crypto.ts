import { isSyncPayload } from './merge';
import type { SyncPayload } from './types';

/**
 * End-to-end encryption for the sync blob.
 *
 * Two independent values are derived from the pairing code with HKDF: the id
 * the server files the row under, and the key that encrypts its contents.
 * Different `info` strings make them independent, so the server — which only
 * ever sees the id — learns nothing about the key, and an id leaked from a log
 * cannot decrypt anything.
 *
 * No PBKDF2 stretching: the code is 120 bits straight from `getRandomValues`,
 * not a human-chosen password, so there is no low-entropy input to slow an
 * attacker down over.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Fixed and public. The entropy lives in the code, not here. */
const SALT = enc.encode('seseri-sync-v1');

const ID_INFO = 'seseri-sync-id-v1';
const KEY_INFO = 'seseri-sync-enc-v1';

const IV_BYTES = 12;

/** Plain JSON. Only used when the platform has no `CompressionStream`. */
const V_PLAIN = 1;
/** gzip before encrypting — progress maps repeat their key names heavily. */
const V_GZIP = 2;

export interface SyncKeys {
  /** base64url of 32 bytes: 43 characters, the server's primary key. */
  syncId: string;
  key: CryptoKey;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveBits(codeBytes: Uint8Array, info: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', codeBytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveKeys(codeBytes: Uint8Array): Promise<SyncKeys> {
  const [idBytes, keyBytes] = await Promise.all([
    deriveBits(codeBytes, ID_INFO),
    deriveBits(codeBytes, KEY_INFO),
  ]);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { syncId: base64url(idBytes), key };
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The version byte travels as additional authenticated data, not just as a
 * prefix: flipping it has to fail decryption outright, otherwise an attacker
 * could downgrade a gzip blob to plain and make the client mis-parse it.
 */
export async function sealPayload(keys: SyncKeys, payload: SyncPayload): Promise<Uint8Array> {
  const json = enc.encode(JSON.stringify(payload));
  const packed = await gzip(json);
  const version = packed ? V_GZIP : V_PLAIN;
  const body = packed ?? json;

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new Uint8Array([version]) },
      keys.key,
      body,
    ),
  );

  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = version;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return out;
}

/**
 * Returns null for anything that does not authenticate — a wrong code, a
 * truncated blob, a flipped byte, a version this build does not know. The
 * caller must treat null as "leave local state alone", never as "wipe it".
 */
export async function openPayload(keys: SyncKeys, blob: Uint8Array): Promise<SyncPayload | null> {
  if (blob.length <= 1 + IV_BYTES) return null;
  const version = blob[0];
  if (version !== V_PLAIN && version !== V_GZIP) return null;

  try {
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: blob.subarray(1, 1 + IV_BYTES),
          additionalData: new Uint8Array([version]),
        },
        keys.key,
        blob.subarray(1 + IV_BYTES),
      ),
    );
    const json = version === V_GZIP ? await gunzip(plain) : plain;
    const parsed: unknown = JSON.parse(dec.decode(json));
    return isSyncPayload(parsed) ? parsed : null;
  } catch {
    return null; // authentication failure, bad gzip, or malformed JSON
  }
}
