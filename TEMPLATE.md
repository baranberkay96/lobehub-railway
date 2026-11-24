# LobeHub 2.3 AI Chat Workspace (Postgres, Redis, SearXNG, S3): composer spec

Listing name: **LobeHub 2.3 AI Chat Workspace (Postgres, Redis, SearXNG, S3)**
Description (74 chars): Multi-model AI chat with private login, knowledge base, web search, files.
Category: AI/ML. Icon: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/lobe-chat.svg`
Repository: `baranberkay96/lobehub-railway` (this folder is the repo root).

## Services

| Service | Source | Public | Volume | Healthcheck |
|---|---|---|---|---|
| LobeHub | repo `/services/lobehub` (`FROM lobehub/lobehub:2.3.5@sha256:b34dd5a2…b570`, released 2026-11-22) | domain → 3210 | none | `/api/version`, 1200 s |
| Postgres | `paradedb/paradedb:0.27.0-pg17@sha256:8fb8cafe…3319` (2026-11-19), `shared_preload_libraries=pg_search,pg_cron,pg_stat_statements` | no | `/var/lib/postgresql/data` | — |
| Redis | `redis:8.2.11@sha256:b0b01167…c8d` | no | `/data` | — |
| SearXNG | repo `/services/searxng` (`FROM searxng/searxng:2026.11.20-1ebea4a07@sha256:8140a628…0182` + settings.yml with JSON format) | no | none | `/healthz`, 300 s |
| Bucket | Railway Bucket `Bucket` | — | — | — |

Required input: `LOBEHUB_ADMIN_EMAIL`. Optional: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `AUTH_ALLOWED_EMAILS`.

## Start sequence (`railway-lobehub.cjs`)

1. Form values: `APP_URL` not http(s) → Railway domain; `AUTH_SECRET`/`KEY_VAULTS_SECRET` < 16 chars → SHA-256 (empty KEY_VAULTS_SECRET derived from AUTH_SECRET); invalid `PORT` → 3210; `HOSTNAME=::`; `INTERNAL_APP_URL=http://localhost:$PORT`.
2. `AUTH_ALLOWED_EMAILS` = owner e-mail + listed entries, lower-cased. Never empty: without any e-mail, e-mail login is disabled (`AUTH_DISABLE_EMAIL_PASSWORD=1`) instead of upstream's "anyone may register".
3. Migrations: upstream `/app/docker.cjs`, retried every 10 s for up to 15 min.
4. `JWKS_KEY`: variable if valid, else an RS256 JWKS generated once and kept in `railway_template_kv` (Postgres). Needed for internal async calls (file chunking, image generation) and OIDC.
5. Bucket CORS: SigV4 `PutBucketCors` for `APP_URL` (+ `AUTH_TRUSTED_ORIGINS`), GET/PUT/HEAD, 5 retries, never fatal.
6. Owner: no user with the owner e-mail → `/app/server.js` on 127.0.0.1:3999, `POST /api/auth/sign-up/email` (Better Auth; runs LobeHub's `initUser` hook), temp server killed. Password outside 8-64 → random password nobody knows + log hint. Later starts: if `LOBEHUB_ADMIN_PASSWORD` changed (HMAC fingerprint in `railway_template_kv`), the credential hash is rewritten in Better Auth's scrypt format.
7. Any failure in 4-6 → server still starts, but with e-mail login disabled (fail closed).
8. `require('/app/startServer.js')` (upstream launcher; migrations are a no-op now).

## Improvements over market templates

Market (2026-11): leader "Lobe Chat" 307 active builds the 1.x repo with `ACCESS_CODE` (removed in 2.0; the variable now stops the start). "LobeHub (LobeChat)" 26 active: `lobehub/lobehub:2.3.4`, MinIO (discontinued) with a public bucket, no healthcheck, open registration. "LobeChat" 27 active: `:latest` images, RustFS on `:latest` with a fixed `admin` access key, open registration, no healthcheck.

- LobeHub 2.3.5 and every image pinned by digest; ParadeDB with the preload list upstream requires.
- Never open: owner account created before the public port serves; sign-up limited to the owner e-mail and `AUTH_ALLOWED_EMAILS`.
- Railway Bucket (private, presigned URLs) with automatic CORS instead of MinIO/RustFS.
- `JWKS_KEY` generated and persisted (market templates leave internal JWT features broken).
- Private SearXNG for the web-search tool (upstream compose has it; market templates do not).
- Healthcheck on `/api/version`; odd form values never stop the start (STANDARD 8.29).

Not included: upstream's optional Agent Gateway (`lobehub-gateway`, no licence file, needs a second public WebSocket endpoint and a shared JWKS public key; without it agent runs execute in the browser, which upstream supports) and optional Elasticsearch (pg_search is upstream's default).

## Resources

See "Measured" below. Prices: RAM $10/GB-month, vCPU $20/month, volume $0.15/GB-month. Minimum plan: Hobby recommended (LobeHub alone is close to Trial's 1 GB under load).

## Verification checklist

1. All services SUCCESS; `/api/version` 200; log shows migrations, JWKS, bucket CORS and `owner account … created`.
2. Owner sign-in 200; stranger sign-up rejected; wrong password rejected.
3. Chat page loads; a provider key set in Settings is saved (KEY_VAULTS_SECRET).
4. File upload: presigned PUT to the Bucket 200 (CORS preflight OK), file listed.
5. SearXNG JSON search answers on the private network.
6. Redeploy: owner unchanged; change `LOBEHUB_ADMIN_PASSWORD` → new password works.
7. Odd values (`LOBEHUB_ADMIN_PASSWORD=abc`, `APP_URL=nonsense`, bad e-mail) → SUCCESS with warnings, login locked.

## Open questions

- Agent Gateway / desktop device gateway not deployed (see above).
- Password-reset e-mails need an e-mail provider (not configured by default).
