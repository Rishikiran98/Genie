# Operating Genie

Everything you need to run Genie somewhere other than `npm run dev`. Genie
runs with zero configuration (offline engine, browser storage); every setting
below is opt-in.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `GENIE_LLM_API_KEY` | _(unset)_ | Enables the LLM engine. Unset = offline heuristic engine only. |
| `GENIE_LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible Chat Completions base URL (no trailing slash). |
| `GENIE_LLM_MODEL` | `gpt-4o-mini` | Model id sent to the endpoint. |
| `GENIE_LLM_TIMEOUT_MS` | `20000` | Per-call LLM timeout. On expiry the call is aborted and the request falls back to the heuristic engine. |
| `GENIE_RATE_LIMIT` | `10` | Requests per minute per client IP, per route. `0` disables. |
| `GENIE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `silent`. Idea text is logged only at `debug`. |
| `GENIE_IP_HASH_SALT` | _(random per process)_ | Salt for hashed IPs in logs. Set it to correlate one client across instances/restarts. |
| `NEXT_PUBLIC_SUPABASE_URL` | _(unset)_ | Supabase project URL. Inlined into the client bundle at **build** time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(unset)_ | Supabase anon (publishable) key. Also build-time. Both must be set to enable Supabase. |
| `PORT` | `3000` | Listen port (`next start` / Docker). |
| `HOSTNAME` | `0.0.0.0` (Docker) | Bind address for the standalone server. |

Only the two `NEXT_PUBLIC_*` values are public. Never expose the LLM key or a
Supabase service-role key; Genie needs neither on the client.

## API guards

All three POST routes (`/api/simulate`, `/api/scenario`, `/api/actionplan`)
run the same pipeline in `lib/http.ts`:

1. **Rate limit** → `429` with `Retry-After: <seconds>` and `{ error }`.
2. **Body size** → `413` for bodies over 32 KB. Checked on `Content-Length`
   first and then on the streamed bytes, before `JSON.parse`.
3. **JSON parse** → `400 { error }`.
4. **Validation** (Zod) → `400 { error, issues }`.
5. **Run** → `200 { report, engine }`; unexpected errors → `500 { error }`
   (details go to the log, not the client).

### Rate limiting and the serverless caveat

The limiter (`lib/ratelimit.ts`) is a fixed window, keyed by `route:ip`, with
the IP taken from the first hop of `x-forwarded-for` (then `x-real-ip`). It
only sees the true client behind a proxy that overwrites those headers
(Vercel, most load balancers, nginx with `proxy_set_header`). Direct exposure
lets a client choose its own key.

Counters live in process memory. On serverless or any multi-instance host,
each instance keeps its own counters, so the effective limit is
`GENIE_RATE_LIMIT × instances` and cold starts reset it. That is enough to
stop casual abuse of the LLM proxy but is not a global cap. The
`RateLimiter` interface is async and backend-agnostic; a Redis/Upstash
implementation can replace `getRateLimiter()` without touching the routes.

## Logs

One JSON object per line on stdout. Every line has `ts`, `level`, `event`.

| Event | Level | Fields |
| --- | --- | --- |
| `request.received` | info | `route`, `ipHash` |
| `request.completed` | info | `route`, `ipHash`, `status`, `durationMs`, `reason` (on non-200: `rate_limited`, `body_too_large`, `invalid_json`, `validation_failed`, `unexpected`) |
| `request.failed` | error | `route`, `ipHash`, `name`, `message`, `stack` — every 500 |
| `ratelimit.exceeded` | warn | `route`, `ipHash`, `retryAfterSeconds` |
| `simulation.completed` | info | `feature` (`simulate`/`scenario`/`actionplan`), `engine` (`llm`/`heuristic`), `llmConfigured`, `fallback`, `durationMs` |
| `llm.failed` | warn | `feature`, `errorKind`, `status` (for non-2xx), `errorName`, `message` |
| `storage.fallback` | warn/debug | `from`, `to`, `reason` |

`errorKind` on `llm.failed` is one of:

- `network` — fetch itself failed (DNS, TLS, connection reset)
- `timeout` — `GENIE_LLM_TIMEOUT_MS` elapsed
- `status` — upstream answered non-2xx (`status` carries the code)
- `schema` — upstream answered 2xx but the body was not JSON, had no content, or failed the report schema
- `unknown` — anything else

Client IPs never appear raw; `ipHash` is a salted SHA-256 prefix. API keys
and idea text never appear at `info` or above.

### Computing the fallback rate

`fallback:true` on `simulation.completed` means the LLM was configured but the
heuristic engine answered. With a log file (or `kubectl logs`, `docker logs`,
etc.) piped in:

```bash
# Fallback rate over all LLM-configured simulations
grep '"event":"simulation.completed"' genie.log \
  | grep '"llmConfigured":true' \
  | awk '/"fallback":true/ {f++} END {printf "fallback rate: %d/%d = %.1f%%\n", f, NR, NR ? 100*f/NR : 0}'

# Why — counts by error kind
grep '"event":"llm.failed"' genie.log \
  | grep -o '"errorKind":"[a-z]*"' | sort | uniq -c | sort -rn

# Per feature, with jq
grep '"event":"simulation.completed"' genie.log \
  | jq -r 'select(.llmConfigured) | "\(.feature) \(.fallback)"' | sort | uniq -c
```

A healthy deployment sits near 0 %. A sustained rise usually maps to one
`errorKind`: `timeout` → raise `GENIE_LLM_TIMEOUT_MS` or pick a faster model;
`status` 401/403 → key; `status` 429 → upstream quota; `schema` → the model
is not honouring the JSON contract (try a different model).

## Health endpoint

`GET /api/health` → `200 { "status": "ok", "llmConfigured": boolean, "store": "supabase" | "local" }`.

It reads configuration only — no secrets in the response, no upstream calls,
not rate limited — so it is safe for load-balancer probes and uptime checks.
The Docker image uses it as its `HEALTHCHECK`.

## Docker

`Dockerfile` is multi-stage on `node:22-alpine`, builds Next.js in
`standalone` mode, and runs as an unprivileged `genie` user.

```bash
# Zero-config: offline engine, browser storage
docker build -t genie .
docker run --rm -p 3000:3000 genie

# With runtime settings
docker run --rm -p 3000:3000 \
  -e GENIE_LLM_API_KEY=sk-... \
  -e GENIE_RATE_LIMIT=30 \
  -e GENIE_LOG_LEVEL=info \
  genie

# With Supabase: the public values are inlined into the client bundle at build time
docker build -t genie \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... .
```

`docker logs <container>` gives you the JSON log stream described above.
`.dockerignore` keeps `node_modules`, `.next`, env files, tests and docs out
of the build context.

## Supabase setup

Optional. Without it saved simulations live in the browser.

1. Create a project. Under **Authentication → Providers** make sure **Email**
   is enabled (magic links). Under **Authentication → URL Configuration** add
   your site URL(s) so the link redirects back to Genie.
2. Apply both migrations in order (SQL editor, or `supabase db push` with the
   CLI):
   - `supabase/migrations/0001_init_simulations.sql` — the `simulations` and
     `scenarios` tables.
   - `supabase/migrations/0002_auth_rls.sql` — the columns the current app
     writes (0001 predates them), `user_id uuid references auth.users`
     defaulting to `auth.uid()`, an index on `(user_id, created_at)`, and RLS
     with owner-only `select`/`insert`/`update`/`delete` on `simulations`
     and ownership-through-parent on `scenarios`. Anonymous callers get
     nothing. Safe to re-apply.
3. Rows created before `0002` have `user_id NULL` and become invisible.
   Delete them, or backfill:
   `update public.simulations set user_id = '<auth.users.id>' where user_id is null;`
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at build
   time, deploy, and sign in. The sign-in box only renders when both are set.

The app's store filters by `user_id` too, but RLS is the security boundary:
the anon key is public by design and only RLS keeps users apart. RLS is not
tested in CI. `supabase/verify_rls.sh` replays both migrations on any local
Postgres, emulates `auth.uid()`, and asserts 18 owner/anon cases; run it
after changing a policy, and after applying to a real project sign in as two
users and confirm neither sees the other's saved simulations.
