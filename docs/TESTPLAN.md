# Seseri — Manual test plan

Run through this list before a release. The unit suites and the headless smokes
(`npm run verify`, `npm run smoke`) cover a great deal, but not real devices, real
clocks, real networks or real screen readers — which is most of what is here.

UI labels are quoted in English; with the app in another language, look for the
same control.

## 1. Search and discovery

- [ ] Open **Search** and type "radio drama" → iTunes results listed with artwork, name and artist.
- [ ] Click a result → the podcast screen opens and lists episodes (date and duration visible).
- [ ] Paste an Apple podcast **numeric ID** into the search box → that podcast opens directly.
- [ ] Paste a **raw RSS URL** (e.g. `https://feeds.simplecast.com/54nAGcIl`) → the feed opens.
- [ ] An invalid or dead RSS URL → a visible error; the app does not lock up.
- [ ] A search with no results → the empty-state message.
- [ ] DevTools → Network: if the Worker's `/v1/itunes` answers 502
      (`upstream 403/429`), searches after the first go **straight** to
      `itunes.apple.com` and not back to the Worker; results still arrive.

## 2. Playback (basics)

- [ ] Click an episode → it starts playing; the title and status area update.
- [ ] The play/pause button works.
- [ ] Dragging on the waveform seeks; the time labels update.
- [ ] The skip back/forward buttons skip by the configured number of seconds.
- [ ] The previous/next buttons move through the list.
- [ ] Speed changes between 0.5× and 2.5× and is audible.
- [ ] At the end of an episode the next one starts (with the setting on).
- [ ] Reload the page → the same episode resumes from where it was.
- [ ] Start an episode that has a saved position and, **before it loads**,
      switch to one without a position → the new episode starts from the
      beginning, not at the previous one's position.
- [ ] Lock screen / media keys (Media Session): title and artwork shown; play/pause/next work.

## 3. Sleep timer

- [ ] The presets (5/10/15/30/45/60/90 min), a custom duration and **End of
      episode** can each be chosen; the choice shows in the control.
- [ ] Playback stops when the time is up.

## 4. Subscriptions

- [ ] Star a podcast → it appears as a card under **Library → Subscriptions**.
- [ ] Unstar it → the card goes.
- [ ] Click a subscription card → the podcast opens and remembers the last-played episode (`pp_last_*`).
- [ ] Subscribed podcasts also appear in the subscriptions grid on **Home**.

## 5. Downloads (basics)

- [ ] The download button saves the episode for offline and says so
      ("Episode saved for offline ✓"). §12 and §22 go further.
- [ ] An episode that cannot be fetched shows a visible error — never a silent
      failure.

## 6. Deep links

- [ ] `?podcast=<appleId>` → the podcast opens directly.
- [ ] `?rss=<url>` → the RSS feed opens directly.
- [ ] `?yt=<token>` → YouTube support was removed; the link falls back to Home without an error.

## 7. Settings

- [ ] **Settings** is a full page opened from the tab bar / rail (not a modal); the other sections are reachable from there.
- [ ] Speed, skip durations, auto-next and resume settings persist (reload → kept).
- [ ] The seven accent colours (Amber/Copper/Signal Red/Moss/Teal/Sky/Lilac) change and apply across the UI; Amber is the default.
- [ ] Opening with an accent colour saved by an old version (3.x) maps it to the nearest Sinyal colour (`normalizeAccent`), and the right swatch shows as active.
- [ ] Font size and row height change.
- [ ] The default sort works (Newest → Oldest / Oldest → Newest).
- [ ] "Clear all progress" and "Clear all data" work, each behind the styled confirm dialog.
- [ ] The storage row shows usage; "Delete downloads" works after confirming.

## 8. Theme and language

- [ ] Four themes: **Auto / Dark / Light / OLED Black** — all consistent with the Sinyal palette (warm charcoal surfaces).
- [ ] Change the language in Settings: check **tr / en** fully and at least one of the others spot-wise.
- [ ] Choosing **ar** gives a correct right-to-left layout (directions, alignment, tab bar and rail included).
- [ ] On first launch the language follows the browser's.

## 9. Keyboard

- [ ] While something is playing, from **any** view: Space play/pause, ←/→ seek,
      ↑/↓ previous/next episode.
- [ ] With nothing loaded, those keys do nothing.
- [ ] While an input, select or textarea has focus, none of them fire; Space on a
      focused button presses the button rather than toggling playback.
- [ ] With the Now Playing sheet open, Esc closes it (it adds no history entry — one step closes it).
- [ ] The episode list can be navigated with the keyboard and Enter plays.

## 10. PWA

- [ ] After `npm run build && npm run preview` the service worker registers; offline, the app shell opens.
- [ ] The manifest loads and the browser offers to install the app.

## 11. Resilience

- [ ] Searching with no network → a visible error, no endless spinner.
- [ ] With the third-party proxies turned on (Settings → Privacy) and one of
      them dead, an RSS feed still loads (they are raced).
- [ ] A full `localStorage` does not crash the app (quota pruning).
- [ ] **A corrupt subscription record:** in the DevTools console run
      `localStorage.setItem('pp_favs', JSON.stringify([null, {id:'123', name:'X'}]))`
      → reload. The app opens, the Library shows the good record and silently
      skips the bad one. *(Up to 4.2.4 this meant a blank screen at start-up
      that stayed until the site data was cleared.)*
- [ ] **A hand-edited backup:** add a `null` inside `pp_favs` in an exported
      JSON → import it → reload. It opens the same way.
- [ ] **Screen lock:** play a long episode with battery saver on (Windows:
      *Settings → System → Power → Battery saver*) and wait for the screen to try
      to sleep. The wake lock is taken again after the OS releases it — the
      screen stays awake throughout playback. *(Only visible on a real device;
      a headless test cannot make the OS release the lock.)*

## 12. Offline and downloads

- [ ] An episode's ⤓ button → the "saved" toast; the button turns into ✓.
- [ ] DevTools → Network → Offline → reload: the app opens, the feed lists from the cache, and the downloaded episode plays **and** seeks.
- [ ] A second tap on a downloaded episode → the download is deleted.
- [ ] Settings → the storage row shows usage; "Delete downloads" works.
- [ ] Downloading from a feed whose CDN blocks CORS → the file-download fallback toast.
- [ ] OPML export → import → the same subscriptions (round trip).
- [ ] Importing an OPML with hundreds of entries finishes in one go; shows
      already followed are not added again, and the toast counts only new ones.
- [ ] Export a show followed through Apple → the file has an `xmlUrl`; another
      podcast app (e.g. Pocket Casts) can import it.
- [ ] Import another app's OPML: a show already followed by its Apple id is
      **not added a second time**.
- [ ] **In the Windows installer (the Tauri shell, not a browser):** download an
      episode hosted on a third-party CDN → the "saved" toast appears and the
      DevTools console shows no CSP violation. *(The desktop shell carries its
      own CSP and none of the smoke scripts run it, so this is the only place it
      shows.)*

## 13. Mini player, Now Playing sheet and queue

- [ ] While an episode plays, "Back" → Home (or the previous section); **playback continues** and the mini dock stays at the bottom.
- [ ] Play/pause on the mini dock works in place (no navigation, no sheet).
- [ ] Tap the mini dock or press Enter → the **Now Playing** sheet opens full-screen (at every size) — the feed is not reloaded and the playing episode is marked.
- [ ] While playing, the frequency line on the mini dock animates; paused, or under `prefers-reduced-motion`, it becomes a still line.
- [ ] Drag-to-seek works on the waveform in the Now Playing sheet.
- [ ] The sheet's close button and Esc both close it, and focus returns to the element that opened it.
- [ ] The **Queue** view (not in the tab bar or rail — opened from the Now Playing sheet or with `?view=queue`): ordered list; move up/down, remove and clear all work.
- [ ] A row's queue button → a position badge; when an episode ends **the queue always beats auto-next** (if the queue has episodes, the next queued one plays whatever the auto-next setting is).
- [ ] **Opening another feed keeps the queue**, and it survives a reload (`pp_queue`).
- [ ] Queue rows show which podcast they come from; if an episode from another
      feed is next, that feed is loaded and played when the current one ends.

### Volume

- [ ] The speaker button and slider are in the Now Playing sheet at every size; dragging the slider changes the volume at once.
- [ ] ≥1024px: the mini dock has a speaker and slider too; the two follow each other at once (change one, check the other).
- [ ] The speaker button mutes and unmutes; unmuting brings back the **chosen level**, not full volume.
- [ ] With the slider at zero the icon shows muted; pressing the speaker raises it to an audible level (the press is not wasted).
- [ ] Dragging the slider up from zero while muted unmutes.
- [ ] The level survives a reload and a change of episode.
- [ ] While the sleep timer fades out in its last 30 s the slider **does not move**; cancelling the timer returns the volume to the chosen level (not to full).
- [ ] Keyboard: Tab reaches the slider; arrow keys / Home / End work; the focus ring shows.
- [ ] iOS (Safari): the control never appears — `audio.volume` is read-only there and the hardware buttons are used.

## 14. Desktop layout and theme

- [ ] ≥900px: a **permanent rail** on the left replaces the tab bar (Home/Search/Library/Settings); the active section is highlighted (`aria-current="page"`).
- [ ] ≥900px: the mini dock sits to the right of the rail at full width (it does not cover the rail).
- [ ] ≥900px: the button beside the wordmark **collapses the rail to icons**; labels hide, icons gain tooltips, the mini dock and content slide with it; the choice survives a reload (`aria-expanded` reflects it).
- [ ] While collapsed, the collapse icon is **not drawn at all**; the rail holds only the brand mark and the icons.
- [ ] Pointing at the rail opens it to full width (labels visible) but **the content does not move** — the panel sits over the page. Moving away closes it. Brushing past the edge must not make it flicker (opens after ~120 ms, closes after ~320 ms).
- [ ] **Pressing the collapse button starts closing the rail at once** — even with the pointer still over it: no waiting, no sticking, no re-opening. Rail and content slide together (neither waits for the other). The peek does not open again until the pointer leaves the rail and comes back.
- [ ] Expanding is just as smooth: the content slides along as the rail widens.
- [ ] Clicking a destination (Home/Search/…) in the collapsed rail only goes there, and the rail stays collapsed; clicking **anywhere else** on the rail (the brand mark, empty space) pins it open.
- [ ] Icons do not shift while the rail opens or closes; only its width and the labels change.
- [ ] Tabbing into the rail opens it; the invisible button over the brand mark is drawn when focused and carries an `aria-label`.
- [ ] `[` opens and closes the rail from any view; **on a Turkish-Q keyboard the same physical key** (`ğ`) works too; it does nothing while typing in a text field, or below 900px. It appears in the shortcut list (`?`).
- [ ] ≥900px: the language switcher on Home sits in the **window's** top-right corner, not the 720px reading column's, and does not slide under the first row.
- [ ] <900px: the bottom tab bar and single-pane behaviour stay; the collapse button is not shown.
- [ ] <900px: the four tabs are **evenly spaced** (no gap between Library and Settings); at 320px the longest label ("Einstellungen") fits.
- [ ] ≥900px: **Settings is at the bottom of the rail**, expanded and collapsed; in a very short window nothing overlaps and the rail scrolls.
- [ ] "Auto" theme: when the operating system's theme changes, the app follows live (four themes: Dark/Light/OLED Black + Auto).
- [ ] Episode rows show a progress line; finished ones are dimmed with a ✓.
- [ ] On a phone, the **resume badge** on an episode with a saved position shows
      in full (it moves under the date when it does not fit).

## 15. Responsive and accessibility review

Screenshot tooling: `scripts/shot.cjs` (headless Chrome through
`scripts/lib/harness.cjs`, against `vite preview`; run `npm run build` first).

- [ ] Widths **320 / 360 / 390 / 520 / 600 / 768 / 900 / 1280** — Home, Search, a feed, Settings: no horizontal scrolling, text does not overflow (ellipsis), components do not overlap.
- [ ] At 360×640 the Settings page scrolls vertically and every row is reachable.
- [ ] ≤520px: the sort label is hidden; the sort button still shows the direction.
- [ ] The Light theme at the same widths: contrast and legibility (small mono labels especially).
- [ ] `ar` (RTL): header, controls, list alignment **and the tab bar / rail** are mirrored; nothing overflows.
- [ ] Keyboard: Tab moves through search results and Enter/Space opens them; selects and sliders show a focus ring; tab bar / rail items are reachable with Tab and the active one carries `aria-current="page"`; the Now Playing close button has a meaningful `aria-label`.
- [ ] Long titles: an episode title too long for the dock drifts end to end and back; one that fits **never** moves; under `prefers-reduced-motion: reduce` it does not drift and ends in an ellipsis. In `ar` (RTL) it drifts the other way.
- [ ] Episode list: on a narrow screen the title wraps to two lines (not cut to one); a second line that still overflows ends in an ellipsis.
- [ ] The sleep timer select is as wide as the text it shows: narrow when off (matching the speed select), wider with "End of episode" selected; the options in the open list read in full.
- [ ] The Now Playing sheet shows all its controls (transport + volume + sleep/speed/queue) at **320×568, 375×667 and 390×844**; at ≤740px height the artwork and spacing shrink.
- [ ] The seconds on the skip buttons sit exactly in the middle of the circular arrow (on both surfaces, for every value in Settings: 5/10/15/30/60 · 10/15/30/45/60/90).
- [ ] A search error shows the red error box with "Try again"; no results show the empty state; while loading, the "Searching..." box.

## 16. Worker and deep links

- [ ] With `npm run worker:dev` running, RSS comes through the Worker (`/v1/parse` or `/v1/feed` in Network).
- [ ] With the Worker stopped and the third-party proxies turned on, the same
      feed still loads through them; with the proxies off, it fails with a
      message that says so.
- [ ] The deployed Worker deploys without a `KV` binding and applies the Durable
      Object migration (`LIMITERS` appears in the `wrangler deploy` output).
- [ ] **Against the deployed Worker**, 70 parallel requests from one address:
      the first 60 pass, the rest get `429` with `retry-after: 60`. (In 4.2.5 this
      measurement drew zero refusals out of 200 — the counter was per machine.)
- [ ] Changing address within one IPv6 /64 does not open a new budget; a
      different /64 does.
- [ ] Against an upstream that stops answering half-way, `/v1/feed` returns 504
      within 30 s and the client falls back — it does not wait forever.
- [ ] `?resume=1` → the last opened feed opens (the store shortcut).
- [ ] `?view=search` / `?view=library` / `?view=queue` / `?view=settings` → that view opens directly (cold load).
- [ ] Legacy deep links (`?podcast=`, `?rss=`) still work — a link shared from 3.x opens the same feed today.
- [ ] On a page reached by deep link (a feed **or** `?view=`), "Back" does not leave the site; one step returns to Home (the browser's back button **and** the in-app one).
- [ ] Going from one view to another and then back also returns to Home in one step (the view in between does not pile up in history).
- [ ] The PWA manifest shortcut "Search" opens `?view=search`.

## 17. Playback regression matrix

Try every source × action at least once; mark ✓/✗.

| Source / Action | Play | Seek | Next/Prev | Auto-next | Queue beats auto-next | Offline download + play | Sleep timer | Speed | Media keys | Mini → Now Playing |
|---|---|---|---|---|---|---|---|---|---|---|
| RSS | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| iTunes (resolved to RSS) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Notes:
- **Queue beats auto-next**: with an episode queued, when the playing one ends the queued one plays whether auto-next is on or off (`playback-controller.ts` — `dequeueNext` is always tried before the `autoNext` check).
- **Offline download + play**: tried with DevTools → Network → Offline; the downloaded episode both plays and seeks.
- **Media keys**: lock screen / notification play/pause/next/prev; title and artwork shown.
- **Mini transport**: skip back/forward and play/pause on the mini dock (from 640px, prev/next in the middle; sleep timer and speed on the right, in sync with the sheet's selects); the bottom progress line seeks on tap/drag. The title area or the expand chevron (Enter/Space included) opens the Now Playing sheet without starting a new episode.
- **Playback is independent of browsing**: opening another podcast while one
  plays (including one heard before) neither stops the audio nor clears the
  queue; next/previous walk the **playing** feed.
- **Third-party proxies**: off by default in Settings → Privacy. While they are
  off and the Worker cannot be reached, opening a feed fails with a clear
  message (it does not quietly go to a third party).

### Navigation checks

- [ ] Tab bar (mobile) / rail (desktop): switching between Home/Search/Library/Settings, with the active section highlighted.
- [ ] `?view=` deep links (§16 above) work on a cold load and in in-app navigation.
- [ ] The one-step-back-to-Home rule: feed → back → Home; view → back → Home; view → view → back → Home (never two steps).
- [ ] Esc: closes the Now Playing sheet when open; cancels the confirm dialog when open (focus defaults to Cancel).

## 18. Cross-device sync

The automated tests (`src/sync/*.test.ts`, `worker/test/sync.test.ts`,
`node scripts/smoke-p6-sync.cjs`) run on one machine, with one clock and a fake
backend. What follows can only be checked by hand.

- [ ] **Two real devices** on different networks (PC + phone) pair.
- [ ] **Real clock skew:** set the phone's clock 3 hours ahead by hand and
      listen on both; the PC's newer position still wins. *(The design's riskiest
      behaviour; no headless test can move the OS clock.)*
- [ ] **Against a real Worker and real D1** (`wrangler dev`, then the deployed
      API): CORS, TLS and D1 latency differ from the smoke's.
- [ ] **iOS Safari**, PWA installed on the home screen: does the keepalive push
      really go out when the app is sent to the background? (`beforeunload`
      does not fire there.)
- [ ] Airplane mode → listen → reconnect → the pending push goes out.
- [ ] Typing the code **on a phone keyboard**: the groups are legible, the copy
      button works with the iOS clipboard permission, and a single wrong
      character says the code is wrong (not a 404).
- [ ] The same code pasted into **a third device** works too.
- [ ] **Storage full** on the receiving device: a position is not lost even if
      the sidecar write fails on quota (a stale stamp loses the conflict, which
      is the safe direction).
- [ ] Battery and mobile-data cost over a 2-hour listen is acceptable.
- [ ] "Delete server data" on one device: the other reports it and **does not
      delete its local data**.
- [ ] Restore **a JSON backup from before sync existed**, then sync: the old
      positions do not get fresh stamps and do not roll the other device back.

## 19. The whole archive and the id migration

Episode lists are the show's whole archive from its own feed, not the recent
slice Apple returns. The riskiest part is the **id change**: episodes of a show
opened from Apple move from Apple's ids to the feed's.

- [ ] A show opened from an Apple search lists more than 200 episodes (e.g.
      Radiolab, Today Explained).
- [ ] **With data left by 4.2.6:** stop half-way through an episode on the old
      version, upgrade, open the same show → the position is on the same
      episode, at the same second.
- [ ] In the same migration a **downloaded** episode still shows as downloaded
      and plays. *(Up to 4.2.9 the badge vanished on the **first** load that
      migrated and came back on the second. `smoke-migrate.cjs` chases this
      automatically now, but check it once by hand.)*
- [ ] In the same migration the **queue** and the "last played" pointer point at
      the right episode.
- [ ] When the feed cannot be reached, the list opens with what Apple returned
      (the archive is an improvement, not a requirement).
- [ ] In a build without a Worker (`VITE_API_BASE` empty) the archive still
      arrives — parsed on the device, only slower.
- [ ] **A private feed carrying a credential** (Patreon/Memberful): the URL does
      not go to a third-party proxy; it goes through the Worker or fails with a
      clear message.

## 20. Played state, filters and new episodes

- [ ] Listen to an episode to the end → it is marked played.
- [ ] "Mark as played" on a row → marked; "Mark as unplayed" → the **saved
      position is reset too**.
- [ ] The **All / Unplayed / In progress / Downloaded** filters leave the right
      rows and say how many are hidden.
- [ ] A filter that matches nothing shows the empty-state message (not an error).
- [ ] A screen reader announces the filter chips' group as **"Filter
      episodes"** (not "Sort").
- [ ] Filter and sort search the **whole archive**, not the 200 rows on screen.
- [ ] Two paired devices: mark played on one → the other shows the same. If one
      marks played and the other unplayed at the same moment, **unplayed wins**.
- [ ] **New episodes** on Home: episodes that appeared in followed shows are
      listed; "Clear all" and removing one at a time work.
- [ ] On a platform with app badges the count shows on the app icon; on one
      without, nothing errors.
- [ ] Listening to an episode takes it off the New episodes list.
- [ ] Offline, "Check for new episodes" on Home does not say "Nothing new." but
      **"N shows could not be reached"**.
- [ ] Two paired devices: mark an episode played by hand on one and wait
      **without pausing** → within ~30 s it shows as played on the other.

## 21. Chapters and transcripts

- [ ] A feed with `podcast:chapters`: the chapter list shows in order in Now
      Playing, with the count in its heading.
- [ ] The markers on the scrubber sit at the **right proportions**.
- [ ] Tapping a chapter moves the audio to that second and highlights it.
- [ ] As the audio plays, the highlight moves to the next chapter by itself.
- [ ] Chapters that only carry artwork (no title) are not listed.
- [ ] A feed with `podcast:transcript`: the **Transcript** panel fetches **when
      opened** (no request before), and the lines appear.
- [ ] VTT and SRT are both read; the timestamps are right.
- [ ] Tapping a line moves the audio there and highlights **that line**.
- [ ] An episode with neither shows neither panel.
- [ ] If the transcript cannot be fetched the panel says so and playback carries on.
- [ ] Play **two episodes with transcripts one after the other** and open the
      panel on the second → the second one's transcript loads; the panel does
      not stay on "loading".
- [ ] With the transcript open, open the same show from the list again (the feed
      refreshes) → the panel stays open and the text stays.

## 22. Downloads, automatic downloads and clean-up

- [ ] Starting a download shows a **real percentage** (not a spinner).
- [ ] The cancel button really stops the download; no partial copy is left and
      the row does not show "downloaded".
- [ ] Press the same episode again → it downloads from the start.
- [ ] Settings → **Download new episodes** on: new episodes of followed shows
      download in the background, at most five per check.
- [ ] Settings → **Delete the download once heard** on: a finished episode's
      copy is deleted; **one left half-way is not.**
- [ ] On mobile data with "Wi-Fi only" chosen, automatic downloads stop (where
      the browser reports the connection type; iOS does not).
- [ ] When storage is nearly full a download says there is no room ("Not enough
      storage space for this episode."), and nothing is silently corrupted.
- [ ] An episode URL that returns a sign-in page (HTML) does not show as
      downloaded; the download counts as failed.
- [ ] **A CDN without CORS (a tracking redirect):** e.g. press download on The
      Daily → no offline copy can be made, the URL is handed to the browser and
      the toast says **"Offline save failed — opened in a new tab instead"**. If
      it says *"Download link not found."* that is the bug fixed in 4.2.8 coming
      back. (If the browser blocks the pop-up, no tab opens; the message is
      right but incomplete — check the pop-up permission.)

## 23. When the background copy (prefetch) starts

While playing, the app also fetches its own copy of the episode; that is **a
second transfer** and a deliberate cost (see the header of
`src/player/prefetch.ts`).

- [ ] Play an episode and switch to another **within 20 seconds** → no copy was
      downloaded (nothing new under Settings → downloads).
- [ ] Listen to the same episode **for more than 70 seconds** → the copy
      downloads, and when it finishes playback switches to the local copy
      (playback continues with the network cut).
- [ ] **Pause** while the copy downloads → when it finishes, playback does not
      start by itself; pressing Play continues from the same second.
- [ ] Pause and wait 5 minutes → no copy starts (waiting is not listening).
- [ ] Drag the scrubber to the end → no copy starts.
- [ ] Resume from **the last 2 minutes** of the episode → no copy ever starts.
- [ ] Settings → "Cache while playing" = **Never** → no copy is downloaded.

## 24. Long lists

- [ ] An archive of 900+ episodes opens without stalling; the header shows the
      **whole archive**, and 200 rows are on screen.
- [ ] The "Show … more" button grows the window.
- [ ] Scrolling to the end of the list grows it without pressing the button.
- [ ] Reach "Show … more" with the keyboard (Tab) → the list grows and focus
      moves to **the first new episode**; it does not return to the top of the
      page.
- [ ] Changing the sort or the filter takes the list **back to the top** and
      resets the window.
- [ ] The playing episode shows in the list and can be scrolled to even when it
      lies beyond the window.
- [ ] One `Tab` enters the list once; `↑`/`↓` move between rows and `←`/`→`
      between a row's buttons.
- [ ] A screen reader reads a row as "title — n of total, play".

## 24b. Archives longer than 5000 episodes, and the database upgrade

- [ ] A show with more than 5000 episodes (with the Worker on): the episode
      count shows the **whole** archive, and the oldest episodes are listed.
- [ ] With a tab of the previous version still open, open the new version in
      another tab → the new tab opens feeds (it does not hang); once the old tab
      is closed, the cache row in Settings fills in.

## 25. Start-up failure, diagnostics and fonts

- [ ] The start-up error screen: in the browser console set a broken value such
      as `localStorage.setItem('pp_settings','{')` and open the app → an error
      screen, not a blank page; **Reload** works.
- [ ] **Clear data** asks for two taps; after the second the app opens from
      scratch (no subscriptions, downloads or positions).
- [ ] "Technical detail" opens and shows the version and the error text.
- [ ] Settings → **Copy Diagnostics**: the clipboard is filled and no network
      request goes out (DevTools → Network stays empty).
- [ ] Settings shows "n feeds cached · size"; copies older than 30 days and the
      oldest beyond 80 MB are dropped, never going below five feeds.
- [ ] **No request to `fonts.googleapis.com` / `fonts.gstatic.com` in the
      Network tab**; the typefaces still look right (in airplane mode too).
- [ ] No CSP violation in the console.

## 26. Episode links and topics

- [ ] Share from an episode row → the link opens that episode.
- [ ] Share from Now Playing → the link opens **at that moment**; the "copied"
      toast states the second.
- [ ] Open the link in a clean browser (or a private window) → the show loads,
      the right episode is selected, the position is right.
- [ ] With the Search screen empty, eight **topics** appear; tapping one brings
      real results from that storefront.
- [ ] Tapping the same topic again closes the list.
- [ ] Change the language → both the topics and the results switch to that
      language's storefront.
- [ ] Typing in the search box replaces the topics with results; clearing the
      box brings the topics back.
