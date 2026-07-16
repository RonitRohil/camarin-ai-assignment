# Camarin AI — Frontend

React (Vite, plain JS/JSX — no TypeScript) SPA against the backend in `../backend`.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build tool | Vite | Fast dev server, standard for a plain React SPA. |
| Routing | `react-router-dom` | `/login`, `/signup`, `/jobs`, `/jobs/:id`, all job routes behind a `ProtectedRoute`. |
| HTTP | `axios`, `withCredentials: true` | Backend auth is httpOnly cookies, not bearer tokens — the client never touches the JWT directly. |
| Live updates | `useJobStream` (SSE) with `usePolling` (15s) as a fallback | Matches the backend's SSE design (ADR-5); polling only fires while at least one job is still `pending`/`processing`. |
| Data fetching | Plain `useEffect` + `axios`, no React Query/SWR | Not in the stack per the plan; kept intentionally simple. |

## Pages

- **Login / Signup** — email + password, redirects to `/jobs` on success.
- **JobsList** — upload form (client-side validates type/size before hitting the API), status filter, live-updating list. Flagged jobs are visually distinct; failed jobs show the inline error message and attempt count.
- **JobDetail** — image preview (via the backend's `image_url` field), caption, labels, SafeSearch breakdown per category, and a Retry button (shown only when `status === "failed"`).
- **NotificationsBell** — in the header, for flagged-job notifications.

## Setup

```bash
npm install
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:5002
npm run dev
```

`npm run build` / `npm run lint` for a production build / lint check.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5002` | Vite inlines this into the JS bundle at **build** time, not runtime — if building a Docker image, it has to be passed as a build arg (`--build-arg VITE_API_URL=...`), and must be an address the *browser* can reach, not an internal Docker service name. |

## Known limitations

- **No `/auth/me` endpoint on the backend.** Worked around by caching the sanitized user object (id/email/created_at — nothing sensitive) in `localStorage` after login/signup, and treating a failed `/auth/refresh` as an expired session. Would close this gap with a real endpoint given more time.
- **Single light theme, no dark mode.** The Vite template's `prefers-color-scheme: dark` auto-switching was deliberately dropped (not a toggle) — a specific, one-time decision to stop the UI ambushing with poor contrast, not a statement against dark mode existing at all.
- SSE is the primary live-update path; the 15s polling fallback means a browser without `EventSource` support (or a silently-dropped SSE connection) sees status changes with up to 15s of latency, not real-time.
- No end-to-end test suite (e.g. Playwright) checked into the repo — the actual UI flow was verified manually with a one-off Playwright script during development, not as a maintained test.
