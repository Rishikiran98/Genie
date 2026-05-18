# Genie
Self-Learning Theorem Proving Agent

## API Service (`service/`)

Run locally:

```bash
uvicorn service.api:app --host 0.0.0.0 --port 8080
```

### Endpoints

- `POST /prove` — submit theorem proving job.
- `GET /jobs/{id}` — get job status and result.
- `GET /healthz` — health check.

Example request:

```bash
curl -X POST http://localhost:8080/prove \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"theorem":"theorem add_zero (n : Nat) : n + 0 = n := by", "initial_goal":"n + 0 = n"}'
```

### Queue + Worker

`QUEUE_BACKEND` options:
- `memory` (default): in-process queue + background worker thread.
- `cloudtasks`: `POST /prove` enqueues a Cloud Task that calls `/internal/jobs/process`.

### Job Store

- `USE_FIRESTORE=false` (default): in-memory store.
- `USE_FIRESTORE=true`: persistent Firestore-backed job storage (collection `jobs`).

### Guardrails

- Auth token check via `Authorization: Bearer $API_AUTH_TOKEN`.
- Request-size cap (`MAX_REQUEST_CHARS`).
- Per-minute request limit (`MAX_REQUESTS_PER_MINUTE`).
- Max search depth cap (`MAX_DEPTH_CAP`).
- Max timeout cap (`MAX_TIMEOUT_SECONDS_CAP`).

### Environment variables

- `API_AUTH_TOKEN` (recommended in all environments)
- `QUEUE_BACKEND` = `memory|cloudtasks`
- `USE_FIRESTORE` = `true|false`
- `MAX_REQUEST_CHARS` (default `8000`)
- `MAX_REQUESTS_PER_MINUTE` (default `60`)
- `DEFAULT_DEPTH` (default `8`)
- `DEFAULT_TIMEOUT_SECONDS` (default `30`)
- `MAX_DEPTH_CAP` (default `12`)
- `MAX_TIMEOUT_SECONDS_CAP` (default `120`)
- `WORKER_POLL_INTERVAL_SECONDS` (default `0.2`, memory queue only)

Cloud Tasks specific:
- `GCP_PROJECT`
- `GCP_REGION`
- `CLOUD_TASKS_QUEUE`
- `WORKER_BASE_URL` (public Cloud Run URL for this service)

### GCP deploy

Use `scripts/deploy_gcp.sh` to build and deploy to Cloud Run.

```bash
export GCP_PROJECT=your-project
export GCP_REGION=us-central1
export SERVICE_NAME=genie-api
export API_AUTH_TOKEN=replace-me
./scripts/deploy_gcp.sh
```
