#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${AOB_PROJECT_ID:-age-of-brutality-skoomaholic}"
REGION="${AOB_REGION:-europe-west1}"
REPO="skoomaholic-art/Age-of-Brutality"
DEPLOYER_NAME="age-of-brutality-deployer"
RUNTIME_NAME="age-of-brutality-runtime"
POOL_ID="age-of-brutality-github"
PROVIDER_ID="github"

if [ -z "${AOB_BILLING_ACCOUNT:-}" ]; then
  AOB_BILLING_ACCOUNT="$(gcloud billing accounts list --filter='open=true' --format='value(name)' | head -n1 | sed 's#billingAccounts/##')"
fi
if [ -z "${AOB_BILLING_ACCOUNT}" ]; then
  echo "No open billing account found. Set AOB_BILLING_ACCOUNT and rerun."
  exit 1
fi

echo "Creating dedicated Google Cloud project: ${PROJECT_ID}"
gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1 ||   gcloud projects create "${PROJECT_ID}" --name="Age of Brutality"

gcloud billing projects link "${PROJECT_ID}" --billing-account="${AOB_BILLING_ACCOUNT}"

gcloud services enable   run.googleapis.com   cloudbuild.googleapis.com   artifactregistry.googleapis.com   iamcredentials.googleapis.com   sts.googleapis.com   --project="${PROJECT_ID}"

for SA in "${DEPLOYER_NAME}" "${RUNTIME_NAME}"; do
  gcloud iam service-accounts describe "${SA}@${PROJECT_ID}.iam.gserviceaccount.com"     --project="${PROJECT_ID}" >/dev/null 2>&1 ||   gcloud iam service-accounts create "${SA}"     --project="${PROJECT_ID}"     --display-name="${SA}"
done

DEPLOYER_SA="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

for ROLE in   roles/run.admin   roles/cloudbuild.builds.editor   roles/serviceusage.serviceUsageConsumer   roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}"     --member="serviceAccount:${DEPLOYER_SA}"     --role="${ROLE}"     --quiet
done

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}"   --project="${PROJECT_ID}"   --member="serviceAccount:${DEPLOYER_SA}"   --role="roles/iam.serviceAccountUser"   --quiet

gcloud iam workload-identity-pools describe "${POOL_ID}"   --project="${PROJECT_ID}" --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create "${POOL_ID}"   --project="${PROJECT_ID}"   --location=global   --display-name="Age of Brutality GitHub"

gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}"   --project="${PROJECT_ID}" --location=global   --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1 || gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}"   --project="${PROJECT_ID}"   --location=global   --workload-identity-pool="${POOL_ID}"   --issuer-uri="https://token.actions.githubusercontent.com"   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"   --attribute-condition="assertion.repository=='${REPO}'"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
POOL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}"   --project="${PROJECT_ID}"   --role="roles/iam.workloadIdentityUser"   --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${REPO}"   --quiet

cat <<EOF

Dedicated Age of Brutality GCP project is ready.

AOB_GCP_PROJECT_ID=${PROJECT_ID}
AOB_GCP_REGION=${REGION}
AOB_GCP_WIF_PROVIDER=${WIF_PROVIDER}
AOB_GCP_DEPLOY_SA=${DEPLOYER_SA}
AOB_GCP_RUNTIME_SA=${RUNTIME_SA}

No Cloud Run service has been deployed by this script.
EOF
