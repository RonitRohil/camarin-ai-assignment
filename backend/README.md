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
job(id, user_id fk, filename, storage_key, mime_type, size_bytes,
    status enum[pending|processing|completed|failed], attempts, error, created_at, updated_at)
job_result(job_id pk/fk, caption, labels jsonb, safe_search jsonb, flagged, flagged_category, created_at)
notification(id, user_id fk, job_id fk, type, read, created_at)
```

Indexes on `job(user_id, status, created_at)` and `notification(user_id, read)` for list-query performance.

## API reference

All responses: `{ success, status_code, message, result }`. Every endpoint except `/auth/*` and `/health`/`/ready` requires the `access_token` httpOnly cookie (set by signup/login).

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | Also logs in (sets cookies). |
| POST | `/auth/login` | |
| POST | `/auth/refresh` | Reads the refresh cookie, issues a new access token. |
| POST | `/auth/logout` | Clears cookies; stateless JWT, nothing server-side to invalidate. |
| POST | `/jobs` | Multipart `image` field. JPG/PNG/WEBP only, 5MB max, magic-byte verified (not just the declared `Content-Type`). Returns `202 { job_id }` immediately. |
| GET | `/jobs` | `?status=&page=&limit=`. |
| GET | `/jobs/stream` | SSE, per-user channel. Must be requested before `/jobs/:id` in the router — otherwise `:id` would swallow `"stream"` as a literal ID. |
| GET | `/jobs/:id` | Includes `job_result` and an `image_url` (signed URL / local static path) for a preview. |
| POST | `/jobs/:id/retry` | Only valid on a `failed` job (409 otherwise). Resets `attempts` to 0, resumes from whichever stage actually failed. |
| GET | `/notifications` | `?page=&limit=`. |
| POST | `/notifications/:id/read` | |
| GET | `/health`, `/ready` | |

Full request/response examples: [`bruno/`](../bruno) — open in the Bruno desktop app, or import the Postman-compatible export.

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

19 unit tests (`vitest`) across `tests/pipeline.test.js` (caption/vision stage functions, mocked HF/Vision clients) and `tests/retry.test.js` (checkpoint/resume logic across every combination of already-checkpointed stages, permanent-vs-transient error handling, the worker-level exhausted-retries safety net, and the actual BullMQ backoff config values) — the explicit minimum bar per the assignment's evaluation criteria, not a bonus.

`vi.mock()` doesn't intercept `require()` in this CommonJS setup (confirmed via an isolated repro — it only reaches ESM `import`, never a nested `require()` at any depth). Mocking here uses manual `require.cache` substitution instead.

## Scalability under 10x load

The real bottleneck is the free-tier AI APIs, not this service's own infrastructure. More worker replicas don't help until rate-limiting/backpressure is added per-provider — that's the single most important thing to get right before scaling workers out. Once that's in place, horizontal worker scaling is a replica-count change away (BullMQ needs no coordination between consumers on the same queue) — the code is already written so this doesn't require a rewrite. The API layer is already stateless (state lives in Redis pub/sub, not in-process), so it scales the same way. At real volume, Postgres would need connection pooling (PgBouncer) and the `jobs` table would benefit from time-based partitioning; Redis becomes a single point of failure at scale, mitigated by using a managed/clustered provider and leaning on the fact that job processing is already idempotent (the checkpoint mechanism above), so a failover-triggered redelivery is safe.

## Known limitations

- **Not yet deployed.**
- Self-hosted caption model doesn't fit a 512MB free-tier RAM budget even quantized — see the captioning section above.
- Worker has no HTTP health endpoint (no HTTP server exists in `worker.js` to check against) — the original "healthz/readyz on both services" idea would need a small dedicated listener added.
- `/uploads` (local storage driver) is served unauthenticated via `express.static` — storage keys are unguessable UUIDs, but this isn't hardened access control.
- No GitHub Actions CI yet. No OpenAPI spec (Bruno collection instead, per the spec's own "Bruno or OpenAPI" wording).
- Worker concurrency is hardcoded to 1 — concurrent inference calls against the self-hosted model singleton are unverified, and rate-limit-aware concurrency (per the scalability section above) isn't implemented yet.
- No `/auth/me` endpoint — the frontend works around this by caching the sanitized user object client-side after login/signup.
