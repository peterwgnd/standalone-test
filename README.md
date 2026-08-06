# 📊 Standalone Sensemaking AI

Welcome to **Standalone Sensemaking AI**! This repository contains an all-in-one, turnkey system to collect open-ended survey responses, conduct real-time AI follow-up interviews, and automatically synthesize the results into interactive visual reports—all running securely on Google Cloud.

---

## 🌟 1. What This Platform Does

Collecting feedback from hundreds or thousands of people usually means choosing between rigid multiple-choice surveys or overwhelming walls of text. Standalone Sensemaking AI gives you the best of both worlds:

* 💬 **Adaptive AI Interviewing:** As participants answer open-ended questions, the Gemini large language model formulates gentle, tailored follow-up questions in real-time to help respondents elaborate on their ideas.
* 🧠 **Automated Thematic Analysis:** When you close your survey or upload existing CSV data, the cloud analytics pipeline clusters opinions, detects common topics, and extracts key quotes.
* 📈 **Interactive Visual Reports:** The system compiles your data into a standalone, portable HTML report featuring interactive cluster graphs, topic breakdowns, and exportable summaries.
* 🔒 **Private & Secure:** You own 100% of your infrastructure and data. Everything runs inside your own Google Cloud and Firebase environment.

---

## 🚀 2. Get Ready & Deploy (Under 5 Minutes)

You do **not** need any coding experience or developer tools installed on your computer to launch Standalone Sensemaking AI. The deployment process is completely automated via Google Cloud Shell.

### 📋 What You'll Need Before Clicking:

1. **A Google Cloud Project:**  
   If you don't have one yet, create a project for free in the [Google Cloud Console](https://console.cloud.google.com/projectcreate) (ensure billing is enabled for the project).
2. **Your Google Email:**  
   The email address you use to sign in to Google. This will automatically become your **Global Admin** account so you can log in to the dashboard.
3. **A Free Gemini API Key:**  
   Get a free key in 10 seconds at [Google AI Studio](https://aistudio.google.com/app/apikey) (click **Create API key**).

---

### 👉 When You're Ready, Click to Deploy!

Click the button below to launch the automated setup wizard directly in your browser:

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/peterwgnd/standalone-test.git&cloudshell_tutorial=tutorial.md&show=terminal)

> **What happens next:**
> 1. Cloud Shell opens with a step-by-step tutorial on the right and a terminal on the left.
> 2. Click the **arrow icon ⤓** on the code box in the tutorial, then press **Enter ↵** in the terminal to launch the setup.
> 3. Press **Enter ↵** to accept your active project and email, then paste your Gemini API key and hit **Enter ↵**.
> 4. Sit back! In about 3–5 minutes, your terminal will print your live **Admin Dashboard URL** (`https://<YOUR-PROJECT-ID>.web.app/dashboard`).

---

## ⚙️ 3. Technical Details

*This section is intended for developers, cloud engineers, or anyone interested in the underlying architecture and manual deployment workflows.*

### 🏗️ Architecture & Codebase Organization

The repository is structured into four core components:

```
├── front-end/               # SvelteKit web application (Admin UI + Respondent Portal)
├── functions/               # Firebase Cloud Functions v2 (Node.js backend bridge)
├── orchestrator/            # Heavy analytics orchestrator & Docker container (Python)
├── terraform/               # Infrastructure as Code (GCP & Firebase provisioning)
├── firebase-config/         # Firestore rules, security validations, and indexes
├── setup.sh                 # Fully automated click-to-deploy bootstrap script
└── tutorial.md              # Cloud Shell guided walkthrough
```

#### 1. Web Application (`/front-end`)
* Built with **SvelteKit** and styled with **TailwindCSS**.
* **Admin Dashboard (`/dashboard` & `/admin/[slug]`):** Real-time response metrics, open/closed survey state toggling, invite token generation, pipeline execution controls, and report viewers.
* **Respondent Portal (`/[slug]/survey`):** Client-facing survey interface with live adaptive interview prompts.
* Protected by **Firebase App Check** (reCAPTCHA Enterprise) and **Firebase Authentication** with custom claims.

#### 2. Cloud Functions (`/functions`)
* **`generateFollowUp`:** Listens to Firestore response submissions and calls the Google GenAI SDK (`gemini-2.5-flash`) to generate structured follow-up questions.
* **`triggerAnalyticsPipeline` / `cancelAnalyticsPipeline`:** Orchestration bridge that triggers and monitors Google Cloud Run v2 Jobs.
* **`initAdmin` & `syncAdminClaims`:** Manages RBAC custom claims (`admin: true`) for administrator accounts.
* **`deleteSurvey`:** Performs atomic recursive deletions across Firestore collections and Cloud Storage buckets.

#### 3. Data Processing Orchestrator (`/orchestrator`)
* Standalone Python data pipeline (`survey_analytics_orchestrator.py`) executed as a **Google Cloud Run Job**.
* Pulls upstream clustering and sensemaking tools from `Jigsaw-Code/sensemaking-tools`.
* Executes unsupervised topic clustering, auto-rating, and quote extraction.
* Uses an isolated Node.js sub-process to build a single-file HTML report and uploads it to Firebase Storage.
* Packaged as a secure, non-root container (`appuser`, UID `10001`).

#### 4. Infrastructure as Code (`/terraform`)
Provisions all cloud infrastructure declaratively:
* **Google Artifact Registry:** Stores compiled orchestrator Docker images.
* **Firestore Native Database:** Named database instance `standalone`.
* **Google Secret Manager:** Secure storage for `GEMINI_API_KEY`.
* **Cloud Run v2 Job:** Serverless execution environment configured with dedicated Service Account.
* **reCAPTCHA Enterprise & Firebase App Check:** IAM service identity binding and token verification.

---

### 🛠️ Manual Deployment Instructions

If you prefer to deploy using the command line without the automated `setup.sh` script, follow these steps:

#### 1. Prerequisites & GCP Authentication
```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export ADMIN_EMAIL="you@example.com"
export GEMINI_API_KEY="your-gemini-api-key"

gcloud config set project $PROJECT_ID
gcloud auth application-default login
```

#### 2. Provision Cloud Infrastructure with Terraform
```bash
# Create state bucket
gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" --location="${REGION}"

cd terraform
terraform init -backend-config="bucket=${PROJECT_ID}-tfstate"
terraform apply -var="project_id=${PROJECT_ID}" -var="region=${REGION}" -auto-approve

# Store Gemini API Key in Secret Manager
echo -n "${GEMINI_API_KEY}" | gcloud secrets versions add GEMINI_API_KEY --data-file=- --quiet
cd ..
```

#### 3. Build & Deploy the Orchestrator Container
```bash
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/standalone-analytics-repo/orchestrator:latest"

# Build image with Cloud Build
gcloud builds submit --tag ${IMAGE_URL} orchestrator

# Update Cloud Run Job with newly built image
gcloud run jobs update analytics-orchestrator-job \
  --image ${IMAGE_URL} \
  --region ${REGION}
```

#### 4. Configure & Deploy Frontend and Cloud Functions
```bash
# Configure Functions environment
echo "ADMIN_EMAIL=${ADMIN_EMAIL}" > functions/.env

# Install dependencies
(cd front-end && npm install && npm run build)
(cd functions && npm install)

# Fetch client SDK config
firebase apps:sdkconfig WEB --json --project="${PROJECT_ID}" > front-end/src/firebase-config.json

# Deploy to Firebase
firebase deploy --project "${PROJECT_ID}" --force
```

---

### 💻 Local Development & Testing

To run the frontend locally connected to Firebase emulators:

```bash
cd front-end
npm install
npm run dev
```

To run the Python analytics pipeline directly on your machine against local CSV or Firestore data:

```bash
cd orchestrator
pip install -r requirements.txt
export GEMINI_API_KEY="your-gemini-key"

python survey_analytics_orchestrator.py -s YOUR_SURVEY_SLUG -o /tmp/output
```

---

### 📄 License & Contributing

* **Code of Conduct:** Please refer to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
* **Contributing Guidelines:** See [CONTRIBUTING.md](CONTRIBUTING.md).
* **License:** Apache 2.0 License. See [LICENSE](LICENSE) for details.
