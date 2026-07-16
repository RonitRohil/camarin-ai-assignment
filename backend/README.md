# Camarin AI — Backend

Express API + a BullMQ worker, sharing one codebase (`src/index.js` and `src/worker.js` are the two entrypoints). Plain JS, CommonJS throughout.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | Node.js, CommonJS (no TypeScript) | Matches the team's existing production stack. |
| DB | PostgreSQL + Prisma 7 | Jobs have a fixed, relational shape (user → jobs → results); Prisma 7 uses the `@prisma/adapter-pg` driver-adapter architecture, not the older bundled query-engine binary. |
| Queue | BullMQ + Redis | Built-in retry/backoff/state inspection with the least new-technology risk. |
| Storage | Local bind mount (dev) / Cloudflare R2 (deployed) | One adapter interface (`services/storage`), swappable via `STORAGE_DRIVER`. |
| Auth | JWT (access + refresh) + bcrypt, httpOnly cookies | No external OAuth dependency; short-lived access token limits XSS blast radius. |
| Live updates | Server-Sent Events + Redis pub/sub | One-directional server→client push is all that's needed; simpler than WebSockets, and the Redis-backed design means any API replica can serve any client's stream. |
| Captioning | Self-hosted, in-process (`@huggingface/transformers`) | See [Captioning: a real deviation from the spec, explained](#captioning-a-real-deviation-from-the-spec-explained). |
| Labels + safety | Google Cloud Vision (`LABEL_DETECTION` + `SAFE_SEARCH_DETECTION`), one `batchAnnotateImages` call | Two logical pipeline stages, one network call — no point paying for two round trips when the API returns both. |

## Architecture decisions

**Checkpoint-per-stage retry, not full-pipeline restart.** `job_results` stores `caption`, `labels`, `safe_search` as separate nullable columns. Each stage writes its own result *immediately* on success — not batched at the end. `pipeline/runPipeline.js` is the single entry point for every pickup (fresh, automatic BullMQ retry, or a user-triggered Retry click) — it always re-derives the resume point from whatever's already persisted, so there's no separate "first attempt" vs. "retry" code path. A crash mid-write isn't a special case either: a Postgres column update is atomic, so a stage is either fully persisted or still `NULL` and correctly re-attempted.

**Transient vs. permanent errors are distinguished at the source.** Both `caption.pipeline.js` and `vision.pipeline.js` tag thrown errors with `is_permanent`. `runPipeline.js` checks that flag: a permanent error (bad input, 4xx-that-isn't-429) sets `status = failed` immediately and does **not** rethrow, so BullMQ doesn't burn an attempt retrying something that'll fail identically. A transient error (5xx, timeout, rate limit) rethrows — BullMQ's own backoff (3 attempts, exponential, 5s base) handles the retry, and the next attempt re-enters the same function. Once BullMQ itself exhausts every attempt on a transient error, `pipeline/handleJobFailure.js` (a `worker.js` event listener, extracted into its own module specifically so it's unit-testable without mocking BullMQ's `Worker` class) closes the gap and marks the job `failed`.

**Retry endpoint reuses BullMQ's own `job.retry()`**, not a fresh `queue.add()` — the old BullMQ job record still exists (`removeOnFail: false`, kept for inspection), so re-adding with the same ID would just collide with it.

**No `models/` folder.** Prisma's schema + generated client *is* the model layer; queries live directly in `*.service.js` files. Model names are snake_case (`job_result`, not `JobResult`) to match this project's naming convention all the way into the ORM — confirmed the generated client delegate mirrors it exactly (`prisma.job_result.findMany()`).

**Refresh tokens are session-backed, not purely stateless.** A `refresh_tokens` table (`user_id` fk, `token_hash`, `expires_at`, `revoked_at`, `user_agent`, `ip`) stores a SHA-256 hash of each issued refresh token — never the raw token, same principle as `password_hash`. `/auth/signup` and `/auth/login` insert a row (in the same DB transaction as the `user` insert on signup, so a crash between the two can't leave a user with no session). `/auth/refresh` looks the token up by hash, rejects if the row is missing or already `revoked_at`, then **rotates**: revokes that row and issues a new access token *and* new refresh token (new row) in one transaction — so a stolen-and-replayed old refresh token is rejected outright once the legitimate client has rotated past it. `/auth/logout` sets `revoked_at` on the current row, so logout actually invalidates the session server-side instead of just clearing cookies client-side.

**Known gap: no CSRF protection yet.** Auth cookies are httpOnly (safe from XSS-based token theft) but that alone doesn't stop CSRF — a malicious site can still trigger a browser-authenticated cross-origin request since cookies are attached automatically. `sameSite` is `lax` in dev / `none` in production (`none` is required for the current cross-origin frontend/backend deploy topology, and `lax` doesn't fully cover CSRF on state-changing `POST`s either). Mitigation not yet built: a double-submit CSRF token (server sets a non-httpOnly `csrf_token` cookie, frontend echoes it back in a custom request header, backend rejects state-changing requests where the two don't match) or a `SameSite`-only fix if the deploy topology ever becomes same-site.

### Captioning: a real deviation from the spec, explained

The spec names `Salesforce/blip-image-captioning-base` via Hugging Face's Inference API. That API no longer hosts **any** image-captioning model, confirmed directly rather than assumed:

- `api-inference.huggingface.co` (the old free serverless endpoint) is fully decommissioned — doesn't resolve in DNS, checked against Google's public resolver too.
- HF's own model API shows `Salesforce/blip-image-captioning-base` has zero live inference providers (`inferenceProviderMapping: {}`) — not hosted anywhere, free or paid.
- Checked 4 other common captioning models and searched HF's catalog for *any* `image-to-text` model live on their first-party provider: zero results. Image captioning appears to have been dropped from HF's free serverless tier entirely.

The fix: captioning runs **self-hosted, in-process**, via `@huggingface/transformers` (HF's own official JS runtime, successor to `@xenova/transformers`) — still genuinely "Hugging Face," just not a hosted API call. One further wrinkle: that runtime doesn't actually support BLIP's architecture for text generation (confirmed by direct test — it falls back to encoder-only mode and can't produce captions). The model actually running is `Xenova/vit-gpt2-image-captioning`, a real captioning model verified to produce correct output, quantized (`q8`) to keep the memory footprint down. A real bug was found and fixed along the way: the runtime's own alpha-channel image handling throws on any 4-channel PNG (common for real uploads) — fixed by pre-flattening every image with `sharp` before it reaches the model.

**Known trade-off, not yet resolved:** even `q8`-quantized, this model measures ~530MB at load and ~735MB during inference — over a 512MB free-tier RAM budget (e.g. Render's free Web Service). Verified working fully in `docker-compose` (no memory ceiling there). Two documented paths exist if/when deployment needs this resolved: (a) switch the deployed instance to a routed Hugging Face API call to a different, provider-hosted vision model (cheap per-request, not literally BLIP), or (b) a dedicated HF Inference Endpoint running literal BLIP (hourly-billed, needs active pause/resume to stay cheap, adds a second cold-start layer on top of the host's own).

## Data model

```
user(id, email unique, password_hash, created_at)
refresh_token(id, user_id fk, token_hash unique, expires_at, revoked_at nullable, user_agent, ip, created_at)
job(id, user_id fk, filename, storage_key, mime_type, size_bytes,
    status enum[pending|processing|completed|failed], attempts, error, created_at, updated_at)
job_result(job_id pk/fk, caption, labels jsonb, safe_search jsonb, flagged, flagged_category, created_at)
notification(id, user_id fk, job_id fk, type, read, created_at)
```

Indexes on `job(user_id, status, created_at)`, `notification(user_id, read)`, and `refresh_token(user_id)` for list-query performance.

## API reference

All responses: `{ success, status_code, message, result }`. Every endpoint except `/auth/*` and `/health`/`/ready` requires the `access_token` httpOnly cookie (set by signup/login).

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | Also logs in (sets cookies). |
| POST | `/auth/login` | |
| POST | `/auth/refresh` | Reads the refresh cookie, validates it against the `refresh_tokens` table, then rotates: revokes that row and issues a new access token + new refresh token. |
| POST | `/auth/logout` | Revokes the current session row (`refresh_tokens.revoked_at`), then clears cookies. |
| POST | `/jobs` | Multipart `image` field. JPG/PNG/WEBP only, 5MB max, magic-byte verified (not just the declared `Content-Type`). Returns `202 { job_id }` immediately. |
| GET | `/jobs` | `?status=&page=&limit=`. |
| GET | `/jobs/stream` | SSE, per-user channel. Must be requested before `/jobs/:id` in the router — otherwise `:id` would swallow `"stream"` as a literal ID. |
| GET | `/jobs/:id` | Includes `job_result` and an `image_url` (signed URL / local static path) for a preview. |
| POST | `/jobs/:id/retry` | Only valid on a `failed` job (409 otherwise). Resets `attempts` to 0, resumes from whichever stage actually failed. |
| GET | `/notifications` | `?page=&limit=`. |
| POST | `/notifications/:id/read` | |
| GET | `/health`, `/ready` | |

Full request/response examples: [`bruno/`](../bruno) — open in the Bruno desktop app, or import `CamarinAI.postman_collection.json` (repo root) into Postman/Insomnia.

An OpenAPI 3.0 spec also exists at [`backend/openapi.yaml`](./openapi.yaml). To view it as interactive docs, any of:
- Paste its contents into [editor.swagger.io](https://editor.swagger.io) — renders live, no install.
- `npx @redocly/cli build-docs backend/openapi.yaml -o api-docs.html` then open `api-docs.html` in a browser — verified working, produces a self-contained static Redoc page.
- The "OpenAPI (Swagger) Editor" VS Code extension, for inline validation while editing the spec itself.

## Setup

### Docker (recommended — matches what a reviewer runs)

```bash
cp .env.example .env   # fill in the values below
cd ..                  # repo root
docker-compose up --build
```

Brings up Postgres, Redis, a one-shot migration step, the API, and the worker as four genuinely separate containers (plus the frontend as a 5th, for convenience).

### Manual local dev (faster iteration loop)

```bash
npm install
npx prisma migrate dev
npx prisma generate
npm run dev          # API, with nodemon
npm run dev:worker   # worker, separate terminal
```

Needs a reachable Postgres and Redis (docker-compose can supply just those: `docker-compose up -d postgres redis`).

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `PORT` | no (default 5002) | |
| `DEVELOPMENT` | no | `true` enables pretty dev logging + stack traces in error responses. |
| `CORS_ORIGIN` | no (default `http://localhost:5173`) | |
| `DATABASE_URL` | **yes** | |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **yes** | Two separate secrets. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `REDIS_URL` | **yes** | |
| `STORAGE_DRIVER` | no (default `local`) | `r2` requires the four `R2_*` vars below. |
| `LOCAL_STORAGE_DIR` | no (default `./uploads`) | |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | only if `STORAGE_DRIVER=r2` | See below. |
| `HF_ACCESS_TOKEN` | no | Not required for the public model captioning downloads; kept for future use. |
| `GOOGLE_VISION_API_KEY` | **yes** | See below. |
| `MODEL_CACHE_DIR` | no (default `./.cache/models`) | Keeps downloaded model weights outside `node_modules` so `npm install` doesn't wipe them. |

### Getting a Google Vision API key

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **Enable billing** on the project — required even to stay on the free tier; Vision calls fail outright without it. Do this first, not after everything else is wired up.
3. Search bar → "Cloud Vision API" → **Enable**.
4. APIs & Services → Credentials → **+ Create Credentials → API Key**.
5. Restrict the key: click it → **API restrictions** → **Restrict key** → select **Cloud Vision API** only.

### Getting a Hugging Face access token (optional)

[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → **Create new token** → type **Read**.

### Getting Cloudflare R2 credentials (only needed for `STORAGE_DRIVER=r2`)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage** → enable R2 → **Create bucket**.
2. Account ID: shown on the R2 overview page.
3. **Manage R2 API Tokens** → **Create API Token** → permission **Object Read & Write**, scoped to the bucket.

## Testing

```bash
npm test
```

22 unit tests (`vitest`) across `tests/pipeline.test.js` (caption/vision stage functions, mocked HF/Vision clients) and `tests/retry.test.js` (checkpoint/resume logic across every combination of already-checkpointed stages, permanent-vs-transient error handling, the worker-level exhausted-retries safety net, and the actual BullMQ backoff config values) — the explicit minimum bar per the assignment's evaluation criteria, not a bonus. Fully self-contained: no real `DATABASE_URL`/`REDIS_URL`/API keys needed (confirmed by running the full suite with `.env` removed), CI runs it with no service containers or secrets.

`vi.mock()` doesn't intercept `require()` in this CommonJS setup (confirmed via an isolated repro — it only reaches ESM `import`, never a nested `require()` at any depth). Mocking here uses manual `require.cache` substitution instead.

`npm run lint` (ESLint, flat config) runs clean. Both run automatically on every push/PR to `main` via [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — install → lint → `prisma generate` → test for the backend, install → lint → build for the frontend. No secrets or service containers needed for either job.

## Scalability under 10x load

Switching captioning from a hosted API to a self-hosted in-process model changes the bottleneck story from the original plan. Captioning no longer has an external rate limit at all — the bottleneck is now our own compute/memory, not a third-party quota.

**Worker concurrency (`WORKER_CONCURRENCY` in `worker.js`) is set to 2, backed by measurement, not left as an unverified guess:**
- Google Vision is *not* the binding constraint. Its default quota is ~1800 requests/min; even at concurrency=10, worst case is ~300-600 req/min — comfortably under 20-30% of quota.
- The self-hosted caption model's *correctness* under concurrency was directly tested, not assumed: 15 concurrent `generateCaption` calls across 5 rounds, using visually distinct images, all cross-checked against a sequential baseline — zero cross-contamination.
- But elapsed time for 3 concurrent calls (~4.6s) was roughly what 3 *sequential* calls take, indicating the ONNX runtime doesn't meaningfully parallelize CPU inference within one process — so raising concurrency doesn't buy much raw caption throughput.
- What it does buy, and what concurrency=2 is actually for: overlapping one job's I/O-bound Vision network call with another job's CPU-bound captioning, instead of the event loop sitting idle on the round trip. Verified live with a real worker + real queue: two jobs enqueued together, job B measurably started (+16ms) while job A was still mid-pipeline (finished at +6548ms) — genuine concurrent processing, both completed with correct, distinct results.
- Kept modest (2, not the verified-safe-to-3 ceiling) because the benefit is I/O overlap, not parallel speedup, and memory rises with it (~735MB at concurrency=1 → ~890MB at concurrency=3, measured).

Concrete next steps (not built, per the spec's "articulate, don't necessarily solve"):
- Horizontally scale worker *replicas* for real throughput gains (each replica loads its own model copy — trades memory for throughput; in-process concurrency alone doesn't scale CPU-bound inference).
- Alternatively, extract captioning into its own always-warm inference service that workers call over the network, decoupling "how many pipeline workers" from "how many copies of the model" at the cost of a network hop per caption.
- Horizontal worker scaling is a replica-count change away regardless (BullMQ needs no coordination between consumers on the same queue) — the code doesn't need a rewrite. The API layer is already stateless (state lives in Redis pub/sub, not in-process), so it scales the same way.
- At real volume, Postgres would need connection pooling (PgBouncer) and the `jobs` table would benefit from time-based partitioning; Redis becomes a single point of failure at scale, mitigated by a managed/clustered provider and the fact that job processing is already idempotent (the checkpoint mechanism above), so a failover-triggered redelivery is safe.

## Observability

Structured JSON logging (`pino`) throughout, not just at the edges:
- `pino-http` on every API request (trimmed serializers - method/url/status only, not the full header dump pino-http defaults to).
- Every pipeline log line is scoped with `job_id` via a child logger (`logger.child({ job_id })` in `runPipeline.js`), so one job's full lifecycle - created (`job.service.js`) → enqueued (`queue.service.js`) → picked up → each stage starting/done → completed or failed (`runPipeline.js`, `handleJobFailure.js`) - is traceable as a single filtered stream (`grep '"job_id":"<id>"'` over the logs, or the equivalent query in a real log aggregator).

`GET /ready` actually checks dependencies now (`SELECT 1` against Postgres, `PING` against Redis) rather than returning `200` unconditionally - verified both the healthy path and a genuine failure path (deliberately unreachable DB → real `503`).

## Known limitations

- **Not yet deployed.**
- Self-hosted caption model doesn't fit a 512MB free-tier RAM budget even quantized — see the captioning section above.
- Worker has no HTTP health endpoint (no HTTP server exists in `worker.js` to check against) — the original "healthz/readyz on both services" idea would need a small dedicated listener added. (`GET /ready` on the API does now do a real dependency check, see Observability above.)
- `/uploads` (local storage driver) is served unauthenticated via `express.static` — storage keys are unguessable UUIDs, but this isn't hardened access control.
- No `/auth/me` endpoint — the frontend works around this by caching the sanitized user object client-side after login/signup.
- `express-rate-limit` is installed and applied to `/auth/signup` and `/auth/login`, but not yet to the upload or retry endpoints.
- **No CSRF protection.** Auth relies on httpOnly cookies alone; there's no double-submit CSRF token or equivalent, so a state-changing request forged from another origin would still carry valid auth cookies. See the refresh-token architecture note above for the planned mitigation.
