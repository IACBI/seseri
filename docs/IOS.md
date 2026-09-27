# iOS shell (Capacitor) — a procedure not yet carried out

> **None of the steps in this file has been run.** The Capacitor dependencies
> are not in the repository and no `ios/` directory has been generated: neither
> can be verified without macOS, Xcode and an Apple Developer account, and
> committing an unverified `ios/` tree would be misleading. What follows are the
> steps to take, in order, on a Mac — a continuation of `docs/STORE.md` §5.

The goal is one thing: audio that keeps playing on iOS with the screen locked.
In a Safari PWA, WebKit can suspend the page in the background;
`UIBackgroundModes: audio` plus `AVAudioSession(.playback)` is the only
mechanism that prevents it.

## 1) Dependencies

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios
npx cap init Seseri io.github.iacbi.seseri --web-dir dist
```

## 2) `capacitor.config.ts` (repository root)

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.iacbi.seseri',
  appName: 'Seseri',
  // Bundled assets. Pointing `server.url` at the live site is tempting, but it
  // makes the app unusable offline and invites App Review's "just a website
  // wrapper" rejection outright.
  webDir: 'dist',
  ios: {
    // Keep <audio> out of the full-screen player; background audio depends on it.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
```

After `npm run build`, run `npx cap sync ios`.

## 3) `ios/App/App/Info.plist`

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

Without this key nothing else matters: iOS suspends the app the moment it goes
to the background.

## 4) `ios/App/App/AppDelegate.swift`

Inside `application(_:didFinishLaunchingWithOptions:)`:

```swift
import AVFoundation

// .playback: plays through the silent switch and the screen lock.
// .spokenAudio: the right mode for speech — car systems and AirPods treat it
// differently from music (e.g. pause and resume around a navigation prompt).
try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
try? AVAudioSession.sharedInstance().setActive(true)
```

## 5) What not to do on the client

**Do not replace the audio engine.** Under `WKWebView` with
`AVAudioSession(.playback)` the existing `<audio>` element already plays in the
background. Switching to a second, native audio engine behind
`Capacitor.isNativePlatform()` (`@capacitor-community/native-audio` and the
like) would break speed control, the waveform, the sleep timer and the Media
Session integration — all of them are built around one element
(`src/player/engine.ts`). Keep the single engine.

## 6) Accounts and certificates needed

1. Apple Developer Program membership ($99/year).
2. A signing team and bundle id registered in Xcode.
3. An App Store Connect record and the privacy form (no data collected).
4. The terms-of-service note in `docs/STORE.md` §5 applies to iOS as well.

## 7) A warning about Android

**Do not move Android to Capacitor.** The current TWA gets Chrome's media
foreground service for free; Capacitor's `WebView` does not, and background
audio gets worse unless a native `MediaSessionService` plugin is written.
Details: `docs/STORE.md` §4.
