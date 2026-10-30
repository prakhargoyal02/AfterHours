# AfterHours

**Music feels different together.**

A mobile-first social music application built with React/TypeScript, FastAPI, Supabase and Redis. The product contract is in [PRODUCT.md](PRODUCT.md); the pre-rebuild evidence/status map is in [docs/AUDIT.md](docs/AUDIT.md). The application is under active development, not feature-complete.

## Recovery and current work

The pre-redesign ZIP contained 40 source/config/test files: 38 matched the previous working tree, two had visual changes, none were missing. Backend and database work was preserved. [DESIGN.md](DESIGN.md) records the mercury/liquid motion system.

This pass adds GSAP sheets and transitions, an immersive audio-reactive player, personal queue, persistent SyncWave across navigation, reconnect UI, shared queue saving, fair contributor rotation, temporary reactions/song/playlist cards, host play-next controls, Memory Mix browsing, context settings, automatic configured Jamendo fallback, required photo Stories and tighter API grants.

Real Audius discovery and playback were verified locally. A single-track response-shape bug was fixed. Audio streams directly to the listener; the application stores metadata, not recordings.

## Local setup

Use Node 22+ and Python 3.12. Copy `.env.example` to `.env` and configure **only a dedicated AfterHours Supabase project**. Never use FYNTRA/PRism credentials, tables, Auth or Storage.

```sh
npm ci
python -m venv .venv
python -m pip install -r backend/requirements-dev.txt
docker compose up -d redis
python -m uvicorn backend.main:app --env-file .env --host 127.0.0.1 --port 8000
npm run dev -- --host 127.0.0.1 --port 5173
```

Activate the virtual environment before installing/running Python packages (Windows: `.venv\Scripts\Activate.ps1`). Redis binds only to localhost port **6381**; persistence is disabled because rooms/chat are temporary. Do not replace Redis with an in-memory production fallback.

Frontend: http://127.0.0.1:5173. Health: http://127.0.0.1:8000/api/health.

Apply migrations in filename order only to a new dedicated project. The base migration refuses a project that already has application tables or users. Existing AfterHours deployments apply only subsequent migrations.

## Dedicated service

The connected AfterHours project is `nfgbysvjqxzctobutvcx` in Mumbai. Local `.env` is ignored by Git. All 17 application tables have RLS; avatar/story buckets are private. Email registration and verification were checked as enabled.

Still required for full live operation:

- Start/provision dedicated Redis. No Docker/WSL/Redis installation was found on the checked Windows machine.
- Configure Supabase Auth site URL and exact redirect URLs for localhost/deployment.
- Configure a dedicated Google OAuth client. Google is currently disabled; the UI shows email signup.
- Set the AfterHours-only server service-role key for account deletion. Never use it in a VITE-prefixed variable.
- Set `JAMENDO_CLIENT_ID` for fallback. YouTube has not been implemented; no hidden player or extraction is used.
- Verify real email confirmation/reset, avatar uploads and multi-device sessions after infrastructure setup.

## Verification

```sh
python -m pytest backend -q
node tests/schema.mjs
npm run test:e2e
npx playwright test -c playwright.account.config.ts
npm run build
```

Browser tests run on port 5207 with accounts deliberately unconfigured and deterministic catalog/generated PCM fixtures. They test actual browser audio controls, sheet dismissal, queue behavior, navigation and error/offline states on mobile and desktop. They do not verify live signup.

Realtime integration tests use fakeredis solely in tests. They exercise two WebSocket clients, host authority, timestamped playback, reactions, forged-metadata rejection, origin rejection and session expiry. They do not substitute for a live Redis/multi-device test.

Database checks run migrations in PGlite with separate user roles and verify isolation, blocks, playlist ownership, Music Pass atomicity, required story media and deletion behavior.

## Remaining product scope

SameWave matching/consent, Silent Room video, music-first pings, full friend relationships, profile Music Passes, YouTube official visible-player fallback and additional social/discovery polish remain unfinished. Guided onboarding covers identity, music preferences and privacy with an atomic, caller-only save. Its separate browser suite uses a simulated signed-in session; real email signup remains to be verified. The audit is the baseline, not a completion claim. Deployment alone is not completion.

## Security review

Anonymous execution of privileged functions was explicitly revoked after the live advisor check. Two authenticated-only SECURITY DEFINER functions are intentional: Music Pass redemption needs an atomic cross-owner import; room membership checks need to see blocks in both directions. Both check the caller and use an empty search path. Review this intentional [Supabase advisor category](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) when changing them.
