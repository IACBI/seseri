import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One version number lives in seven files, and nothing checked that they agree.
 *
 * `desktop/src-tauri/Cargo.toml` had been left on `4.1.27` since the 4.1 line
 * while the app shipped 4.2.x. It was inert rather than wrong: Tauri takes the
 * version from `tauri.conf.json` when that field is present, and *falls back to
 * Cargo.toml* when it is not — so deleting one line would have silently shipped
 * an installer claiming to be four minor versions old. A release checklist made
 * of prose did not catch it in eight releases; this does, in the same run that
 * catches everything else.
 */

const root = new URL('../../', import.meta.url);

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
}

function json(rel: string): { version?: string } {
  return JSON.parse(read(rel)) as { version?: string };
}

/** Every place the release steps in CLAUDE.md tell you to bump. */
const APP_VERSION = json('package.json').version;

describe('the version number', () => {
  it('is a plain three-part version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each([
    'package-lock.json',
    'desktop/package.json',
    'desktop/package-lock.json',
    'desktop/src-tauri/tauri.conf.json',
  ])('matches in %s', (rel) => {
    expect(json(rel).version).toBe(APP_VERSION);
  });

  it('matches the package entry inside package-lock.json', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages?: Record<string, { version?: string }>;
    };
    expect(lock.packages?.['']?.version).toBe(APP_VERSION);
  });

  it('matches the Rust crate, which Tauri falls back to', () => {
    // First `version =` after `[package]`, so a dependency's version cannot
    // stand in for the crate's own.
    const toml = read('desktop/src-tauri/Cargo.toml');
    const pkg = toml.slice(toml.indexOf('[package]'));
    const found = /^version\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
    expect(found).toBe(APP_VERSION);
  });

  it('matches the crate entry in Cargo.lock, so the build needs no lock update', () => {
    const lock = read('desktop/src-tauri/Cargo.lock');
    const entry = /name = "seseri"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
    expect(entry).toBe(APP_VERSION);
  });

  it('is the version the app reports at runtime', () => {
    // `__APP_VERSION__` is defined in vite.config.ts from package.json, so this
    // guards the wiring rather than a second copy of the number.
    expect(read('vite.config.ts')).toContain('__APP_VERSION__');
  });
});
