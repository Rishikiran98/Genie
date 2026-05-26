#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT:?Set GCP_PROJECT}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-genie-api}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:$(date +%Y%m%d-%H%M%S)"

: "${API_AUTH_TOKEN:?Set API_AUTH_TOKEN}"

gcloud config set project "${PROJECT_ID}"
gcloud builds submit --tag "${IMAGE}" .

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "API_AUTH_TOKEN=${API_AUTH_TOKEN},QUEUE_BACKEND=${QUEUE_BACKEND:-memory},USE_FIRESTORE=${USE_FIRESTORE:-false},MAX_DEPTH_CAP=${MAX_DEPTH_CAP:-12},MAX_TIMEOUT_SECONDS_CAP=${MAX_TIMEOUT_SECONDS_CAP:-120},MAX_REQUESTS_PER_MINUTE=${MAX_REQUESTS_PER_MINUTE:-60},GCP_PROJECT=${PROJECT_ID},GCP_REGION=${REGION},CLOUD_TASKS_QUEUE=${CLOUD_TASKS_QUEUE:-},WORKER_BASE_URL=${WORKER_BASE_URL:-}"

if [[ "${USE_FIRESTORE:-false}" == "true" ]]; then
  echo "Ensure Firestore (Native mode) is enabled in project ${PROJECT_ID}."
fi

if [[ "${QUEUE_BACKEND:-memory}" == "cloudtasks" ]]; then
  gcloud tasks queues describe "${CLOUD_TASKS_QUEUE:?Set CLOUD_TASKS_QUEUE}" --location "${REGION}" >/dev/null 2>&1 || \
    gcloud tasks queues create "${CLOUD_TASKS_QUEUE}" --location "${REGION}"
fi

echo "Deployment complete: ${SERVICE_NAME} in ${REGION}"
