# Terraform Implementation Plan: Standalone Analytics Platform

## Overview
This plan outlines the steps to migrate the manual Google Cloud Run deployment (currently residing in `docker_instructions.md`) to a fully automated Infrastructure as Code (IaC) setup using Terraform. This is the foundational step toward achieving a true "click-to-deploy" experience for new users.

## 1. Directory Structure
Create a dedicated `terraform/` directory at the root of the project to cleanly isolate IaC from application code.
```text
terraform/
├── main.tf          # Core resources (Cloud Run, Secret Manager)
├── variables.tf     # Configurable inputs (Project ID, Region, etc.)
├── outputs.tf       # Exported values (Job name, Registry URL)
├── backend.tf       # Remote state configuration (GCS bucket)
└── apis.tf          # Enable required GCP APIs
```

## 2. Required GCP APIs
Terraform will automatically enable the services required for the platform so the user doesn't have to manually click through the GCP Console:
- `run.googleapis.com` (Cloud Run)
- `artifactregistry.googleapis.com` (Artifact Registry)
- `secretmanager.googleapis.com` (Secret Manager)
- `cloudbuild.googleapis.com` (Cloud Build)

## 3. Resource Mapping

### A. Artifact Registry
Instead of pushing to the legacy Container Registry (`gcr.io`), Terraform will provision a modern Artifact Registry repository for the Docker images.
* **Resource:** `google_artifact_registry_repository`

### B. Secret Manager
Terraform will create the Secret Manager entry for the Gemini API Key.
* **Resource:** `google_secret_manager_secret`
* *Security Note:* The actual secret *value* should not be hardcoded in Terraform state. Terraform will create the secret "shell", and the value can be injected at deploy-time via a secure CI/CD variable or prompted during setup.

### C. Service Account & IAM
Following the principle of least privilege, Terraform will create a dedicated Service Account specifically for the Cloud Run Job, replacing the default compute service account.
* **Resource:** `google_service_account`
* **Roles:** `roles/secretmanager.secretAccessor` (for the Gemini API key), `roles/datastore.user` (for Firestore access).

### D. Cloud Run Job
This completely replaces the `gcloud run jobs create` command.
* **Resource:** `google_cloud_run_v2_job`
* **Configuration:**
  - Image: URL from the Artifact Registry
  - Memory: `2Gi`
  - Timeout: `1800s` (30m)
  - Env/Secrets: Bind the `GEMINI_API_KEY` from Secret Manager

### E. Firebase Web App & Frontend Config
To eliminate the friction of manually copying the Firebase config object, Terraform will automatically provision the Firebase Web App and generate the configuration file for the Svelte frontend.
* **Resource:** `google_firebase_web_app` (using `google-beta` provider)
* **Data Source:** `google_firebase_web_app_config`
* **Output:** A `local_file` resource will write the configuration dynamically to `front-end/src/firebase-config.json` before the Svelte app builds. 
*(Note: The backend Cloud Run jobs and Cloud Functions will use the Firebase Admin SDK with Application Default Credentials via the `roles/datastore.user` service account, requiring no configuration objects or API keys).*

## 4. Achieving "Click-to-Deploy" (Path A: Cloud Shell)
Based on the requirement to collect runtime user inputs (like `ADMIN_EMAILS` and `GEMINI_API_KEY`), we will utilize **Path A (Google Native)** via Cloud Shell.

1. **The Entry Point:** Provide a standard "Run on Google Cloud" button in the `README.md`.
2. **The Automation:** Clicking the button opens Cloud Shell, automatically clones the repository, and runs a provided `setup.sh` bash script.
3. **Project ID Inference:** `setup.sh` automatically retrieves the active GCP Project ID using `gcloud config get-value project`.
4. **Minimal Prompts:** `setup.sh` explicitly asks the user *only* for configuration variables that cannot be inferred:
   ```bash
   read -p "Enter the first Admin Email: " ADMIN_EMAIL
   read -p "Enter your Gemini API Key: " GEMINI_KEY
   ```
5. **The Deployment Order:** 
   - **Step 1:** The script passes inputs to Terraform (`terraform apply -var="admin_email=$ADMIN_EMAIL"`) to deploy the backend and dynamically write the Svelte `firebase-config.json`.
   - **Step 2:** *After* Terraform completes, the script builds the Svelte app (which now has the config) and uses the Firebase CLI (`firebase deploy`) to deploy the frontend and functions.

## 5. Handling Future Upstream Updates
The Cloud Run Dockerfile utilizes `git clone` to fetch the upstream pipeline logic dynamically. To allow users to pull future updates seamlessly:
*   **Manual Method:** The user re-clicks the "Run on Google Cloud" button. Since the `setup.sh` and Terraform configurations are idempotent, it will simply re-trigger Cloud Build to fetch the latest code and update the Cloud Run job.
*   **Automated Method:** Provision a `google_cloud_scheduler_job` via Terraform to trigger Cloud Build on a nightly/weekly cron schedule, guaranteeing the analytics orchestrator always runs the freshest pipeline models.

## 6. Next Steps for Implementation
1. **Scaffold:** Create the `terraform/` directory and write the core `main.tf` covering the Cloud Run Job and Secret Manager.
2. **Setup Script:** Write the `setup.sh` script to handle the Cloud Shell prompts and orchestrate Terraform + Firebase.
3. **User Management:** Implement the Cloud Functions and Svelte Admin UI to support in-app user management, utilizing the `ADMIN_EMAIL` provided during Step 4.
