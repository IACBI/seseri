/**
 * Shared plumbing for the headless scripts (smokes + screenshot generators).
 *
 * Every one of them had its own copy of four things, and two of the copies were
 * the reason the smokes could only run on one machine:
 *
 *   - The browser was the literal path to Microsoft Edge on Windows, so CI
 *     could not run any of this. `resolveBrowser` looks in the obvious places
 *     on all three platforms and takes `SESERI_BROWSER` first, which is what
 *     the CI job passes.
 *
 *   - The dev server was spawned through `npx.cmd` with `shell: true`. On
 *     Windows that makes `SIGTERM` kill the shell and leave vite running: the
 *     orphan holds `esbuild.exe` and rollup's native binding (a later `npm ci`
 *     then fails with `EPERM: unlink` *after* emptying node_modules) and it
 *     squats the port, serving a stale bundle to the next run — which shows up
 *     as `invalid rss` and looks like a parser bug. `startServer` spawns vite's
 *     own entry with the current node binary and no shell, so the child we
 *     kill is the process that holds the port.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ── browser ─────────────────────────────────────────────────────────
/** Candidates per platform, in the order they are worth trying. */
const BROWSERS = {
  win32: [
    // Chrome first: Edge is also a Chromium, but on this machine it refuses to
    // launch under CDP ("Code: 0", no stderr) while Chrome is fine, and a
    // smoke that cannot open a browser reports nothing useful.
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

/**
 * Path to a Chromium-family browser. `SESERI_BROWSER` wins, so CI can point at
 * whatever it installed; otherwise the platform list decides.
 *
 * Throws rather than returning null: a smoke that silently "passes" because it
 * never opened a browser is worse than no smoke at all.
 */
function resolveBrowser() {
  const fromEnv = process.env.SESERI_BROWSER;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`SESERI_BROWSER is set to ${fromEnv}, which does not exist`);
    }
    return fromEnv;
  }
  const candidates = BROWSERS[process.platform] ?? [];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    `no Chromium-family browser found on ${process.platform}. Set SESERI_BROWSER, ` +
      `or install one of:\n  ${candidates.join('\n  ')}`,
  );
}

/** Flags every script needs: headless audio has to be allowed to start. */
const LAUNCH_ARGS = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];

/**
 * `--no-sandbox` is required in most Linux CI containers and is harmless for a
 * throwaway browser that only ever loads our own localhost build.
 */
function launchArgs(extra = []) {
  const args = [...LAUNCH_ARGS, ...extra];
  if (process.platform === 'linux' && process.env.CI) {
    args.push('--no-sandbox', '--disable-dev-shm-usage');
  }
  return args;
}

/**
 * Everything `puppeteer.launch` needs, in one object.
 *
 * `headless: true` IS the new headless mode from puppeteer 22 on; the string
 * `'new'` these scripts used to pass was removed, and the launch failed with an
 * empty stderr and "Code: 0" — indistinguishable from a missing browser.
 */
function launchOptions(extra = []) {
  return { executablePath: resolveBrowser(), headless: true, args: launchArgs(extra) };
}

// ── vite server ─────────────────────────────────────────────────────
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * Start `vite preview` (the default) or `vite dev` on `port`.
 *
 * No shell, and vite's own entry script run by this process's node binary, so
 * the returned child IS the server and killing it releases the port.
 */
function startServer({ port, mode = 'preview', env } = {}) {
  if (!port) throw new Error('startServer needs a port');
  const args = [VITE_BIN];
  if (mode === 'preview') args.push('preview');
  args.push('--port', String(port), '--strictPort');
  return spawn(process.execPath, args, {
    cwd: ROOT,
    shell: false,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
}

/** Kill the server and don't come back until the OS has actually reaped it. */
function stopServer(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    proc.once('exit', done);
    try {
      proc.kill('SIGTERM');
    } catch {
      return resolve();
    }
    // A server that ignores the polite signal gets 3 s before SIGKILL.
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 3000);
  });
}

function waitServer(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (n) =>
      http
        .get(url, (r) => {
          r.resume();
          resolve();
        })
        .on('error', () =>
          n <= 0 ? reject(new Error(`no server at ${url}`)) : setTimeout(() => ping(n - 1), 500),
        );
    ping(tries);
  });
}

// ── fixtures ────────────────────────────────────────────────────────
/**
 * A real, playable WAV of `seconds` length — silence at 8 kHz, 8-bit mono.
 * Built rather than committed so the smokes carry no binary fixtures.
 */
function makeWav(seconds = 120) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ── result collection ───────────────────────────────────────────────
/**
 * The PASS/FAIL tally every smoke prints. `finish` returns the exit code so
 * the caller's `finally` stays a one-liner.
 */
function results() {
  const passes = [];
  return {
    ok(name, pass, extra = '') {
      passes.push(!!pass);
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
    },
    finish() {
      const fails = passes.filter((p) => !p).length;
      console.log(`\n${passes.length - fails}/${passes.length} passed`);
      return fails ? 1 : 0;
    },
  };
}

module.exports = {
  ROOT,
  launchArgs,
  launchOptions,
  makeWav,
  resolveBrowser,
  results,
  startServer,
  stopServer,
  waitServer,
};
