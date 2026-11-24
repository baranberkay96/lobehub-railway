# Notice

This package deploys **LobeHub** (https://github.com/lobehub/lobehub), licensed under the **LobeHub Community License**: Apache License 2.0 plus conditions. Commercial use as a frontend and backend service is allowed without modifying the source code; developing and distributing a derivative work needs a commercial licence from LobeHub LLC (hello@lobehub.com). This template runs the official image `lobehub/lobehub:2.3.5` **unmodified** and only adds a start script outside the application code. If you change LobeHub's source and distribute it, check the licence first.

What is used and how:

- `services/lobehub/railway-lobehub.cjs` is original work for this template. It calls upstream's own `/app/docker.cjs` (migrations), `/app/server.js` and `/app/startServer.js` from the image, and the documented Better Auth sign-up endpoint.
- Configuration follows upstream `docker-compose/deploy/docker-compose.yml`, `.env.example`, `setup.sh` (JWKS generation), `Dockerfile` and `packages/env/src/{auth,file}.ts` at tag `v2.3.5` (checked 2026-11-24).
- Better Auth password hash format (scrypt) as implemented in `better-auth/utils` (MIT), reproduced for the password-reset step.
- `services/searxng/settings.yml` is original (SearXNG `use_default_settings` overrides). SearXNG is AGPL-3.0 (https://github.com/searxng/searxng); the image is used unmodified.
- ParadeDB image (`paradedb/paradedb`, AGPL-3.0) used unmodified. Redis service definition from Railway's official templates.
- Icon: Dashboard Icons (https://github.com/homarr-labs/dashboard-icons).

Market templates were read for comparison only; no files or text were copied. README and docs text are original.

This is a community template and is not affiliated with or endorsed by LobeHub LLC.
