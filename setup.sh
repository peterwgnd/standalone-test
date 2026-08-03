#!/bin/bash

# Exit immediately if any command fails
set -e

echo "🚀 Starting Standalone Analytics Platform click-to-deploy setup..."

# 0. Environment Setup
# Google Cloud Shell recently removed the terraform binary due to licensing changes. 
# We must dynamically install it if the system stub is detected.
if ! command -v terraform >/dev/null 2>&1 || terraform --version 2>&1 | grep -q "instructions at"; then
    echo "📦 Installing Terraform (this will only happen once)..."
    wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --yes --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null 2>&1
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(grep -oP '(?<=UBUNTU_CODENAME=).*' /etc/os-release || lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null
    sudo apt-get update > /dev/null 2>&1
    sudo apt-get install -y terraform > /dev/null 2>&1
fi

# 1. Collect User Inputs
echo "--------------------------------------------------------"
echo "👋 We need 3 quick details to configure your environment:"
echo "--------------------------------------------------------"

# Try to get the active project, if any
DEFAULT_PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)

if [ -z "$DEFAULT_PROJECT_ID" ]; then
    read -p "1. Enter your Google Cloud Project ID: " PROJECT_ID
else
    read -p "1. Google Cloud Project ID [Press Enter to use '$DEFAULT_PROJECT_ID']: " INPUT_PROJECT_ID
    PROJECT_ID=${INPUT_PROJECT_ID:-$DEFAULT_PROJECT_ID}
fi

# Ensure project is set in gcloud so subsequent commands work seamlessly
gcloud config set project $PROJECT_ID

read -p "2. Enter your Google account email (for Global Admin access): " ADMIN_EMAIL

echo ""
echo "👉 Need a free Gemini API key? Get one in seconds at: https://aistudio.google.com/app/apikey"
read -p "3. Enter your Gemini API Key: " GEMINI_KEY
echo ""

# 2. Define Variables
REGION="us-central1"
JOB_NAME="analytics-orchestrator-job"
IMAGE_NAME="orchestrator"
IMAGE_TAG="latest"

echo "--------------------------------------------------------"
echo "⚙️  Configuring backend with Admin Email..."
echo "ADMIN_EMAIL=${ADMIN_EMAIL}" > functions/.env

# 3. Infrastructure as Code (Terraform)
echo "🏗️  Setting up Terraform Remote State..."

# Define a unique bucket name for state storage
STATE_BUCKET="${PROJECT_ID}-tfstate"

# Create GCS bucket for state if it doesn't exist
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" --quiet >/dev/null 2>&1; then
  echo "📦 Creating state bucket gs://${STATE_BUCKET}..."
  gcloud storage buckets create "gs://${STATE_BUCKET}" --location="${REGION}" --uniform-bucket-level-access
fi

cd terraform

# Initialize backend dynamically pointing to the state bucket
terraform init -reconfigure -backend-config="bucket=${STATE_BUCKET}"

# Securely pass variables to Terraform
export TF_VAR_project_id="${PROJECT_ID}"

# Securely create secret shell & inject Gemini API key version via gcloud (keeps sensitive key out of terraform.tfstate)
if ! gcloud secrets describe GEMINI_API_KEY --quiet >/dev/null 2>&1; then
  echo "🔑 Creating Secret Manager secret GEMINI_API_KEY..."
  gcloud secrets create GEMINI_API_KEY --replication-policy="automatic" --quiet
fi
echo "🔑 Injecting Gemini API key into Secret Manager..."
echo -n "${GEMINI_KEY}" | gcloud secrets versions add GEMINI_API_KEY --data-file=- --quiet

echo "🔍 Checking for pre-existing resources to auto-import..."

# Auto-heal: Service Account
SA_EMAIL="analytics-orchestrator-sa@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${SA_EMAIL}" --quiet >/dev/null 2>&1; then
  echo "   - Importing Service Account..."
  terraform import google_service_account.cloud_run_sa "projects/${PROJECT_ID}/serviceAccounts/${SA_EMAIL}" >/dev/null 2>&1 || true
fi

# Auto-heal: Artifact Registry
if gcloud artifacts repositories describe standalone-analytics-repo --location="${REGION}" --quiet >/dev/null 2>&1; then
  echo "   - Importing Artifact Registry..."
  terraform import google_artifact_registry_repository.app_repo "projects/${PROJECT_ID}/locations/${REGION}/repositories/standalone-analytics-repo" >/dev/null 2>&1 || true
fi

# Auto-heal: Secret Manager
if gcloud secrets describe GEMINI_API_KEY --quiet >/dev/null 2>&1; then
  echo "   - Importing Secret Manager Secret..."
  terraform import google_secret_manager_secret.gemini_api_key "projects/${PROJECT_ID}/secrets/GEMINI_API_KEY" >/dev/null 2>&1 || true
fi

# Auto-heal: Cloud Run Job
if gcloud run jobs describe "${JOB_NAME}" --region="${REGION}" --quiet >/dev/null 2>&1; then
  echo "   - Importing Cloud Run Job..."
  terraform import google_cloud_run_v2_job.analytics_orchestrator "projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}" >/dev/null 2>&1 || true
fi

# Auto-heal: Firebase Project (checks if Firebase API is enabled)
if gcloud services list --enabled --quiet | grep -q "firebase.googleapis.com"; then
  echo "   - Importing Firebase Project..."
  terraform import google_firebase_project.default "projects/${PROJECT_ID}" >/dev/null 2>&1 || true
fi

# Auto-heal: Firestore Database 'standalone'
if gcloud firestore databases describe --database=standalone --quiet >/dev/null 2>&1; then
  echo "   - Importing Firestore Database..."
  terraform import google_firestore_database.standalone "projects/${PROJECT_ID}/databases/standalone" >/dev/null 2>&1 || true
fi

# Auto-heal: App Engine Application (Default Firebase Storage Bucket)
if gcloud app describe --quiet >/dev/null 2>&1; then
  echo "   - Importing App Engine Application & Default Storage Bucket..."
  terraform import google_app_engine_application.default "${PROJECT_ID}" >/dev/null 2>&1 || true
  terraform import google_firebase_storage_bucket.default "${PROJECT_ID}/${PROJECT_ID}.appspot.com" >/dev/null 2>&1 || true
fi

# Auto-heal: Identity Platform (Firebase Authentication)
if gcloud services list --enabled --quiet | grep -q "identitytoolkit.googleapis.com"; then
  echo "   - Importing Identity Platform (Firebase Auth) Configuration..."
  terraform import google_identity_platform_config.default "projects/${PROJECT_ID}/config" >/dev/null 2>&1 || true
fi

# Provision infrastructure
echo "🚀 Applying Terraform configuration (with auto-retry)..."
MAX_RETRIES=3
RETRY_COUNT=0
until terraform apply -auto-approve; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Terraform provisioning failed after ${MAX_RETRIES} attempts. Please check your network connection and try again."
    exit 1
  fi
  echo "⚠️ Network interruption detected during Terraform apply. Automatically retrying in 5 seconds (attempt $((RETRY_COUNT+1))/${MAX_RETRIES})..."
  sleep 5
done

# Automatically enable Google Sign-In in Firebase Authentication (no OAuth client ID/secret required)
echo "🔑 Enabling Google Sign-In authentication provider..."
curl -s -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com?updateMask=enabled" >/dev/null 2>&1 || true

# Extract the Registry URL for the Docker push
REPO_URL=$(terraform output -raw artifact_registry_url)
IMAGE_URL="${REPO_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
cd ..

# 4. Build & Push Docker Image
echo "🐳 Building and pushing the Docker image via Cloud Build (with auto-retry)..."
MAX_RETRIES=3
RETRY_COUNT=0
until gcloud builds submit --tag ${IMAGE_URL} .; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Cloud Build failed after ${MAX_RETRIES} attempts. Please check your network connection and try again."
    exit 1
  fi
  echo "⚠️ Network interruption detected during Docker build. Automatically retrying in 5 seconds (attempt $((RETRY_COUNT+1))/${MAX_RETRIES})..."
  sleep 5
done

# 5. Swap the Dummy Image
echo "🔄 Updating Cloud Run Job with the compiled image..."
gcloud run jobs update ${JOB_NAME} \
  --image ${IMAGE_URL} \
  --region ${REGION}

# 6. Deploy Frontend and Functions
echo "📦 Installing Frontend and Cloud Functions dependencies..."
(cd front-end && rm -rf node_modules && npm install)
(cd functions && rm -rf node_modules && npm install)

echo "🌐 Fetching Firebase client SDK configuration..."
echo "{\"projects\":{\"default\":\"${PROJECT_ID}\"}}" > .firebaserc

APP_ID=$(firebase apps:list WEB --json --project="${PROJECT_ID}" 2>/dev/null | node -e '
  let d = "";
  process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    try {
      const parsed = JSON.parse(d);
      const apps = parsed.result ? parsed.result : parsed;
      if (Array.isArray(apps) && apps.length > 0) {
        console.log(apps[0].appId);
      }
    } catch(e) {}
  });
' || true)

if [ -n "$APP_ID" ]; then
  firebase apps:sdkconfig WEB "$APP_ID" --json --project="${PROJECT_ID}" 2>/dev/null | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(d);
        const cfg = data.result ? (data.result.sdkConfig || data.result) : data;
        const fs = require("fs");
        fs.writeFileSync("front-end/src/firebase-config.json", JSON.stringify(cfg, null, 2));
        const envContent = [
          `VITE_FIREBASE_API_KEY=${cfg.apiKey || ""}`,
          `VITE_FIREBASE_AUTH_DOMAIN=${cfg.authDomain || ""}`,
          `VITE_FIREBASE_DATABASE_URL=${cfg.databaseURL || ""}`,
          `VITE_FIREBASE_PROJECT_ID=${cfg.projectId || ""}`,
          `VITE_FIREBASE_STORAGE_BUCKET=${cfg.storageBucket || ""}`,
          `VITE_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId || ""}`,
          `VITE_FIREBASE_APP_ID=${cfg.appId || ""}`
        ].join("\n");
        fs.writeFileSync("front-end/.env", envContent);
      } catch(e) {
        console.error("Warning: Could not parse SDK config JSON:", e.message);
      }
    });
  ' || true
else
  echo "⚠️ Warning: Could not detect Web App ID automatically. Continuing deploy..."
fi

echo "🌐 Deploying Svelte Admin UI and Cloud Functions (with auto-retry)..."
MAX_RETRIES=3
RETRY_COUNT=0
until firebase deploy --project "${PROJECT_ID}" --force --non-interactive; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Deployment failed after ${MAX_RETRIES} attempts. Please check your network connection and try again."
    exit 1
  fi
  echo "⚠️ Network interruption detected during deploy. Automatically retrying in 5 seconds (attempt $((RETRY_COUNT+1))/${MAX_RETRIES})..."
  sleep 5
done

echo "--------------------------------------------------------"
echo "✅ Deployment complete! Your Standalone Analytics Platform is live:"
echo "👉 Admin UI URL: https://${PROJECT_ID}.web.app/dashboard"
echo "--------------------------------------------------------"
