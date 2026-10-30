# AfterHours — recovery and implementation audit

Audit date: 30 October 2026. This is the pre-rebuild baseline, based on inspected source, not product promises. Complete means the stated narrow implementation was verified; partial does not mean production-ready.

## Recovery evidence

- Active repository: `C:/Users/goyal/Documents/Codex/2026-10-29/referenced-chatgpt-conversation-this-is-an/outputs/AfterHours`.
- Remote: `https://github.com/prakhargoyal02/AfterHours.git`; branch `codex/afterhours-public-app`; HEAD `96bd9b8`.
- Requested `/mnt/data` path is not present on this Windows host. The named backup was found at `C:/Users/goyal/Downloads/AfterHours_BEFORE_REDESIGN_96bd9b8.zip`.
- All 40 regular ZIP files compared with newline normalization: 38 identical, 2 changed (`src/App.tsx`, `src/styles.css`), **0 missing**. Full comparison and ZIP SHA-256 are in `recovery-comparison.json`.
- Current App differences are presentation changes. Backend, auth, schema/RLS, provider adapters, realtime, tests and Liquid analyser are identical to the backup. No module restoration is necessary. Wholesale replacement would discard newer visual work without recovering functionality.
- Existing uncommitted App/CSS changes and screenshot/skill files predate this audit. Preserve them separately before rebuilding. No FYNTRA or PRism code, configuration, database, auth or storage is in scope.

## Status map

Legend: ✅ Complete · 🟡 Partial · 🔴 Missing · 🔵 Needs redesign · ⚙️ Backend exists, UI missing · 🎨 UI exists, logic missing.

| Module | Status | Evidence and remaining work |
|---|---|---|
| 1. Frontend/screens | 🟡 🔵 | React/Vite/TypeScript; App, Account, Library, Social, SyncWave. Discovery is a marketing-style hero/table; navigation is local state. No immersive Now Playing, splash/onboarding journey, route recovery, global queue sheet or persistent room shell. |
| 2. Auth/onboarding | 🟡 🔵 | Account.tsx implements Google, email/password, verification messaging, reset/recovery, logout, profile/avatar/preferences and delete-account UI. Auth trigger creates profiles. No local .env connection; live signup/OAuth unverified. No mandatory onboarding completion flow; profile-load failures leave loading text. |
| 3. Playback/search/provider layer | 🟡 | providers.py normalizes tracks behind a protocol; audio.ts uses Audio and Web Audio analyser. App has play/pause/seek/previous/next/shuffle/repeat/volume. Search is tracks only. Queue is implicitly current search results; navigation away from SyncWave unmounts its controller. Source errors and rapid track switching need hardening. |
| 4. Provider fallbacks | 🟡 / 🔴 | Audius and Jamendo adapters exist; Jamendo needs a client ID. User manually selects provider; automatic fallback is absent. YouTube is only a type value rejected by MusicPlayer; no official API adapter or visible player. |
| 5. Playlists/likes/artists/history | 🟡 | CRUD playlists, add/remove songs, likes, artist follow, history note editing/deletion exist. No playlist reordering, followed-artist management or complete saved queue workflow. History logs once per consecutive track ID and requires history preference. Live persistence unverified. |
| 6. WeatherFlow | 🟡 🎨 | City weather, 5-minute refresh, mood/genre/temperature ranking and five feedback types exist. Profile stores region/languages/artists, but ranking ignores them; time/season/weather-code/context unused. UI says mood engine online even on failure. No ML training is present or needed here. |
| 7. SyncWave | 🟡 🔵 | Server timestamps, revision numbers, host authority, RTT midpoint clock estimate, 2-second drift check, hard seek >1.5s and ±2% rate corrections exist. Nine modes are labels only. No verified multi-browser Redis flow, immediate clock sync, reliable reconnect, host succession or auto-advance. Controller is tied to tab mount. |
| 8. Shared queue | 🟡 | Host/everyone/turns/vote enforced in live.py. Turns picks someone other than last contributor rather than a fair round-robin across all members. No queue remove/reorder, save-as-playlist, play-next or requests UI. saved_queues table alone is not a working feature. |
| 9. Temporary chat | 🟡 🔵 | Redis-only text and song card; enqueue from card; last 100 messages; six-hour hard room TTL and 90-second abandoned-room grace; end clears messages. No playlist cards, reaction model, play-next/requests, avatar bubble, or integrated floating sheet. Abrupt socket death relies on presence cleanup; needs expiry integration tests. |
| 10. Music Pass | 🟡 | QR/code for all tracks in likes/selected playlist; atomic import RPC, expiry, one-use protection and block check. No selected-song picker, profile pass or follow workflow. QR contains raw code, not a deep link. |
| 11. Memory Mix/session history | 🟡 ⚙️ | Metadata-only session save, date/participant/song display, replay track buttons, Memory Mix insertion. No Memory Mix browsing/player. Save includes queued tracks not necessarily played; repeated save collides with unique key. |
| 12. Stories | 🟡 | Photo upload, mandatory song, caption, 24-hour filtering, signed images, delete and public-profile RLS. **Photo is optional in both UI and SQL**, violating locked product contract. No reactions or expired-media cleanup job. |
| 13. Profiles/friends/social | 🟡 | Public username search, follow, block/report, profile privacy. No friends acceptance, follower lists, unfollow screen or playlist discovery UI. Public playlist RLS exists. Private profiles do not have a friends-sharing policy. |
| 14. SameWave | 🔴 ⚙️ | Only opt-in preference and server-write-only connection table. No proximity service, configurable radius, matching, Wave/Hi handling, rejection lockout, cooldowns or minimal-history UI. No precise GPS history exists. |
| 15. Silent Room | 🔴 | No video signaling, camera controls, video transport, or text/music integration. Must remain video-only with no microphone capture. |
| 16. Music pings | 🔴 | Miss You / Thinking of You / Listen With Me / Knock have no model, endpoints or UI. |
| 17. Supabase schema/RLS/storage | 🟡 | Dedicated empty-project guard; owner policies, public profile/content visibility, blocking, signup trigger, cascading deletion, private avatar/story buckets. Local policy simulation exists. No live project binding verified. Stories photo constraint and media retention need work; service configuration is not delivery evidence. |
| 18. Redis/WebSockets | 🟡 | Redis lock, pub/sub, TTL, presence, rate limiting, origin allowlist, first-frame token auth and periodic revalidation. Compose has dedicated ephemeral Redis service. No running Redis/integration evidence yet; member list is not live presence; abrupt disconnection and multi-worker lifecycle need tests. |
| 19. Tests/build/deploy | 🟡 | Production build passes baseline. Python core tests and PGlite policy suite present; browser suite mocks discovery and checks navigation/errors on two viewports. Does not validate real provider playback, signup, live rooms, camera or production configuration. No backend deployment manifest beyond Redis Compose. |
| 20. UI/UX/motion | 🔵 | Manrope, dark olive/cream, CSS transitions, canvas contour driven by FFT. GSAP absent from package manifest. Liquid exists only in hero; paused still drifts. No context motion system, artwork ambience, mobile gestures, focus-managed overlays or offline state. Dense forms and footer player dominate functional screens. |

## Preserve and repair first

Preserve provider normalization, token-authenticated FastAPI, private storage, RLS tests, Redis authority/locking/expiry, drift correction and real Web Audio analyser. Refactor their UI boundaries instead of replacing their logic. Record a recovery checkpoint before edits.

Priority defects: story without photo; room lifecycle lost on tab change; discovery retry switches to search; connection state reports connected before authentication; initial playback clock offset unknown; failed playback can display the wrong current track; async library/profile errors need recoverable states; no queue auto-advance.

## Locked rebuild contract

“Music feels different together.” Dark mercury/liquid atmosphere, mobile-first with intentional desktop, artwork ambience, immersive player, floating accessible queue/chat/settings, meaningful GSAP choreography. Calm paused state; real analyser energy controls pulse; focus subdues, Couple warms, Party energizes, rain ripples. Reduced motion must remain functional. No bulky dashboard grid, purple Spotify imitation, one-phone Bluetooth sharing, voice calling, hidden YouTube extraction or copied copyrighted audio.

Execution: recovery audit → preserve current state → design/motion system → Splash/Auth → Discover → Now Playing → persistent SyncWave → Queue/Chat → remaining library/social/context/pass/proximity/video scope → build and meaningful integration checks → correct repository commit/push. Deployment is only a checkpoint.

## External verification needed

Dedicated AfterHours Supabase identity/configuration, Google OAuth setup, email delivery, Redis runtime, provider keys and real two-device playback have not been verified. Do not mark these complete based on source or mocked tests. Never borrow configuration from another project.
