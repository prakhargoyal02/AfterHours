# AfterHours

Music feels different together.

## Platform and purpose
One mobile-first public consumer music product, with a responsive desktop companion. Continue this repository; do not split product generations or label features by version.

## Product contract
- Public self-service Google and email/password accounts, verification, recovery, automatic app profiles, unique usernames, profile editing, avatar, bio, region/languages/genres/artists/moods, private defaults, blocking/reporting and account deletion.
- Supabase PostgreSQL and Storage own persistent app data. Redis owns live rooms, presence, queues, playback timestamps and session-bound chat with expiry. FastAPI owns business logic, recommendations and WebSockets.
- Provider-independent normalized tracks. Audius primary; official visible YouTube player only; Jamendo/open audio fallback; licensed commercial adapters only when access exists. Store metadata and provider IDs, never copied copyrighted recordings.
- Search songs/artists/albums/playlists; complete transport; likes, followed artists, playlist editing, editable/deletable history; immersive Now Playing with artwork and an actual audio-reactive waveform.
- WeatherFlow uses refreshed weather, temperature, local time, season, region, preferences and first-party listening feedback. Regional/language overrides. Feedback includes Not interested, Less like this, Never this artist/song, Not for this mood. Explainable ranking; no restricted provider-data training.
- SyncWave: Couple, Friends, Party, Distance, Road Trip, Bike Ride, Hiking, Study/Focus, Workout. Host authority, shared queues, host/everyone/turns/vote policies, clock offset and drift correction. Save queue and metadata-only session replay; Memory Mix from shared history.
- Floating session chat supports reactions and music/playlist cards/actions; no permanent inbox. Chat expires when all leave after a grace period; summaries never include messages.
- Music Pass codes/QRs for tracks, playlists and music profiles, with expiry and limited/one-time uses, import/copy/follow workflows.
- Private/public profiles, social follows, playlist discovery, song-required photo Stories with minimal captions. No video stories or text-only statuses. Silent Room is video + music + text, never voice. Music-first pings only.
- SameWave is opt-in proximity around a configurable ~100m radius; never exact location disclosure/history. Mutual first contact only Wave/Hi; rejection stops contact, with cooldowns and rate limits. Retain minimal connection metadata only.
- No one-phone multi-earbud/Bluetooth-output sharing. Multiple listeners use their own devices through SyncWave. No generic voice calls or permanent messaging.

## Visual commitments
Dark, organic, liquid/mercury surfaces, expressive but smooth movement, music-reactive artwork/waveform. Playback quiets surrounding motion. Clear controls, reduced-motion support, mobile touch targets and keyboard access.

## Infrastructure isolation
AfterHours MUST have a dedicated Supabase project, Auth users, PostgreSQL database, Storage, RLS policies, migrations and API keys. Never read, modify, migrate or depend on PRism/FYNTRA data or Auth. Only connect a newly created dedicated AfterHours instance. Automatic profile creation uses an Auth trigger in that dedicated project. Account deletion removes the AfterHours identity and its app data/media. Redis must also be a dedicated instance or service for AfterHours.

## Delivery truth
See README.md for verified implementation status and remaining integration work. This contract records the entire intended product, not a claim that every feature is complete.
