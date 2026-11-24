# Deploy and Host LobeHub with Railway

LobeHub (formerly LobeChat) is an open-source AI chat workspace: one interface for OpenAI, Anthropic, Gemini, OpenRouter, Ollama and dozens of other model providers, with agents, a knowledge base, file chat, plugins and web search. This template runs LobeHub 2.3 with its full server stack and a private login.

## About Hosting LobeHub

LobeHub 2.x is a Next.js server backed by PostgreSQL. It stores users, chats, agents and knowledge bases in Postgres (ParadeDB image, which adds the `pg_search` full-text and `pgvector` extensions LobeHub's migrations require), caches in Redis, keeps uploaded files in S3-compatible storage and queries a private SearXNG instance for web search.

Login uses LobeHub's built-in Better Auth. This template never starts with open registration: it creates the owner account from your e-mail and a generated password before the site goes online, and only the addresses or domains you allow can sign up later. Model API keys are optional; every user can also add their own keys in Settings.

## Common Use Cases

- A private ChatGPT-style workspace for a team, with your own API keys and data
- Compare and switch between OpenAI, Claude, Gemini, OpenRouter and other models in one UI
- Chat with documents: upload files into a knowledge base for retrieval
- Build reusable agents with system prompts, tools and web search

## Dependencies for LobeHub Hosting

- LobeHub 2.3.5 (`lobehub/lobehub`, pinned by digest)
- PostgreSQL 17 with `pg_search` and `pgvector` (ParadeDB 0.27.0)
- Redis 8.2
- SearXNG (private metasearch for the web-search tool)
- A Railway Bucket for uploads

### Deployment Dependencies

- LobeHub source and releases: https://github.com/lobehub/lobehub
- Self-hosting docs: https://lobehub.com/docs/self-hosting/start
- Environment variables: https://lobehub.com/docs/self-hosting/environment-variables
- ParadeDB: https://github.com/paradedb/paradedb
- SearXNG: https://docs.searxng.org
- Railway Buckets: https://docs.railway.com/guides/storage-buckets

### Implementation Details

| Service | What it does | Public |
|---|---|---|
| LobeHub | Web app and API (port 3210); migrations, owner account and bucket CORS on start | yes |
| Postgres | ParadeDB (Postgres 17 + pg_search + pgvector + pg_cron), all LobeHub data | no |
| Redis | Cache and rate limits | no |
| SearXNG | Web search for agents (JSON API, private network only) | no |
| Bucket | Files, images and knowledge-base documents (private, presigned URLs) | no |

**First login**

1. Enter your e-mail in `LOBEHUB_ADMIN_EMAIL` when you deploy.
2. Open the LobeHub public URL and sign in with that e-mail and the generated `LOBEHUB_ADMIN_PASSWORD` (LobeHub service, Variables tab).
3. Add a model provider key in Settings, or set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` or `OPENROUTER_API_KEY` on the LobeHub service for everyone.

**Adding users.** Add e-mails or whole domains to `AUTH_ALLOWED_EMAILS` (comma-separated) and redeploy; those people can then sign up on the login page. The owner e-mail is always allowed. Nobody else can register.

**Password reset.** Change `LOBEHUB_ADMIN_PASSWORD` and redeploy: the owner password is set to the new value on the next start. Passwords must be 8-64 characters; a shorter value keeps the owner login locked (the log says how to fix it) instead of failing the deploy.

**E-mail and SSO (optional).** Password-reset e-mails and verification need an e-mail provider (`EMAIL_SERVICE_PROVIDER` with Resend or SMTP; Railway allows outbound SMTP on Pro). SSO providers (GitHub, Google, Microsoft, generic OIDC) are configured with `AUTH_SSO_PROVIDERS` and `AUTH_*` variables as described in the LobeHub docs.

**Uploads.** The Bucket variables are filled in for you. On every start the LobeHub service sets the Bucket's CORS rule for `APP_URL`, so browsers can upload through presigned URLs.

**Custom domain.** Add it to the LobeHub service, set `APP_URL` to `https://{your-domain}` and redeploy.

**Secrets.** `KEY_VAULTS_SECRET` encrypts the API keys users save; never change it after the first start. An RS256 `JWKS_KEY` for LobeHub's internal tokens is generated once and stored in Postgres (set `JWKS_KEY` yourself to override it).

**Scaling.** The LobeHub service is stateless (no volume); you can raise its replica count. Postgres holds all data.

**Versions.** The LobeHub image is pinned in `services/lobehub/Dockerfile` (`LOBEHUB_IMAGE`, tag and digest). To upgrade, use a newer release tag and digest, back up Postgres, and redeploy; migrations run on start.

**Resources.** Measured idle: LobeHub about 0.65 GB RAM, ParadeDB 0.2 GB, SearXNG 0.15 GB, Redis 0.05 GB, so about 1.1 GB in total (roughly $10-13 per month). Hobby or Pro is recommended.

**Licence.** LobeHub uses the LobeHub Community License (Apache 2.0 with conditions): running the unmodified app, also commercially, is allowed; distributing a modified derivative needs a commercial licence from LobeHub. This community template runs the official image unchanged.

### Why Deploy LobeHub on Railway?

Railway runs the whole LobeHub stack, app, ParadeDB, Redis, SearXNG and a private Bucket, from one template with private networking, generated secrets and persistent volumes. You get a private multi-model AI workspace in minutes and pay only for what it uses.
