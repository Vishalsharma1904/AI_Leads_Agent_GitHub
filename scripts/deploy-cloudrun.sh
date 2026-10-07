#!/usr/bin/env bash
# Deploy the Rudra24 AI backend to Cloud Run.
#
# Redis and Celery are in requirements but nothing imports them, so this needs
# one thing besides the container: a PostgreSQL URL. Your Supabase project
# already has one (Supabase → Project Settings → Database → Connection string,
# the "Session pooler" URI), which is the cheapest correct answer.
#
#   ./scripts/deploy-cloudrun.sh <gcp-project-id> [region]
#
# Secrets are read from backend/.env and pushed to Cloud Run as env vars; the
# file itself never leaves your machine and is not in the image (.dockerignore).
set -euo pipefail

PROJECT="${1:?usage: deploy-cloudrun.sh <gcp-project-id> [region]}"
REGION="${2:-asia-south1}"          # Mumbai
SERVICE="rudra24-api"
ENV_FILE="backend/.env"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }

# KEY=VALUE lines only; no comments, no blanks, no export prefix.
ENV_VARS=$(grep -E '^[A-Z0-9_]+=' "$ENV_FILE" | grep -v '^DATABASE_URL=$' | paste -sd',' -)

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy "$SERVICE" \
  --source backend \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --min-instances 1 \
  --max-instances 4 \
  --set-env-vars "APP_ENV=production,$ENV_VARS"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
echo
echo "Backend live at: $URL"
echo
echo "Two things left:"
echo "  1. vercel.json  -> replace REPLACE-WITH-BACKEND-HOST with ${URL#https://}"
echo "  2. backend/.env -> CORS_ORIGINS=https://rudra24-ai.vercel.app"
echo "     ALLOWED_HOSTS=${URL#https://},rudra24-ai.vercel.app   then re-run this script"
