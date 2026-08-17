#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
REGION="${REGION:-us-central1}"
REPO="TheRealShadowCoder/FXGA-Macro-Economics-Dashboard-"
POOL="fxga-github-pool"
PROVIDER="fxga-github-provider"
DEPLOY_SA_NAME="fxga-github-deployer"
RUNTIME_SA_NAME="fxga-collector-runtime"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOY_SA="$DEPLOY_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
RUNTIME_SA="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com \
  cloudtasks.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$DEPLOY_SA_NAME" --display-name='FXGA GitHub deployer'
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" --display-name='FXGA Cloud Run collector runtime'

for ROLE in roles/run.admin roles/artifactregistry.admin roles/secretmanager.admin roles/cloudtasks.admin roles/cloudscheduler.admin roles/datastore.owner roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role="$ROLE" >/dev/null
done
for ROLE in roles/datastore.user roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role="$ROLE" >/dev/null
done

gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name='FXGA GitHub Actions'

gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" \
    --location=global \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
    --attribute-condition="assertion.repository=='$REPO'"

POOL_NAME=$(gcloud iam workload-identity-pools describe "$POOL" --location=global --format='value(name)')
PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --format='value(name)')

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository/$REPO" >/dev/null

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --role=roles/iam.serviceAccountUser \
  --member="serviceAccount:$DEPLOY_SA" >/dev/null || true

cat <<EOF

GCP bootstrap complete.

Add these GitHub repository values without pasting credentials into chat:

Repository variables:
  GCP_PROJECT_ID=$PROJECT_ID
  GCP_REGION=$REGION

Repository secrets:
  GCP_WIF_PROVIDER=$PROVIDER_NAME
  GCP_DEPLOY_SERVICE_ACCOUNT=$DEPLOY_SA
  GCP_RUNTIME_SERVICE_ACCOUNT=$RUNTIME_SA
  COLLECTOR_WEBHOOK_SECRET=<generate a long random secret>

FRED_API_KEY is already expected by the existing repository workflow.

Then run the GitHub workflow: Deploy FXGA Google Cloud Collector
EOF
