#!/bin/bash

# Exit immediately if any command fails
set -e

echo "🚀 Starting Standalone Analytics Platform click-to-deploy setup..."

# 0. Environment Setup
# Google Cloud Shell recently removed the terraform binary due to licensing changes. 
# We must dynamically install it if the system stub is detected.
if ! command -v terraform >/dev/null 2>&1 || terraform --version 2>&1 | grep -q "instructions at"; then
    echo "📦 Installing Terraform (this will only happen once)..."
    wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null 2>&1
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(grep -oP '(?<=UBUNTU_CODENAME=).*' /etc/os-release || lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null
    sudo apt-get update > /dev/null 2>&1
    sudo apt-get install -y terraform > /dev/null 2>&1
fi

# 1. Collect User Inputs
echo "--------------------------------------------------------"
echo "We need a few details to configure your environment."
echo "--------------------------------------------------------"
read -p "Enter your Google account email (this will be the Admin): " ADMIN_EMAIL
read -p "Enter your Gemini API Key: " GEMINI_KEY

# 2. Define Variables
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
JOB_NAME="analytics-orchestrator-job"
IMAGE_NAME="orchestrator"
IMAGE_TAG="latest"

echo "--------------------------------------------------------"
echo "⚙️  Configuring backend with Admin Email..."
echo "ADMIN_EMAIL=${ADMIN_EMAIL}" > functions/.env

# 3. Infrastructure as Code (Terraform)
echo "🏗️  Provisioning foundation with Terraform..."
cd terraform
terraform init
# Provision everything and inject the Gemini Key into the Secret Version
terraform apply -auto-approve -var="gemini_api_key=${GEMINI_KEY}"

# Extract the Registry URL for the Docker push
REPO_URL=$(terraform output -raw artifact_registry_url)
IMAGE_URL="${REPO_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
cd ..

# 4. Build & Push Docker Image
echo "🐳 Building and pushing the Docker image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_URL} .

# 5. Swap the Dummy Image
echo "🔄 Updating Cloud Run Job with the compiled image..."
gcloud run jobs update ${JOB_NAME} \
  --image ${IMAGE_URL} \
  --region ${REGION}

# 6. Deploy Frontend and Functions
echo "🌐 Deploying Svelte Admin UI and Cloud Functions..."
firebase deploy

echo "--------------------------------------------------------"
echo "✅ Deployment complete! Your Standalone Analytics Platform is live."
echo "--------------------------------------------------------"
