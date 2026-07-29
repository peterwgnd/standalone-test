# 📊 Survey Analytics Orchestrator (Standalone)

Welcome to the standalone components of the Survey Analytics Platform! This directory contains everything you need to deploy and run a self-contained survey administration and analysis pipeline. 

If you just found this code on GitHub, you are looking at a system designed to collect open-ended survey responses, process them using the Gemini large language model, and generate a beautiful, interactive visual report—all running on Google Cloud!

---

## 🏗️ Architecture Overview

This project is split into a few key pieces that work together to deliver a seamless experience:

### 1. The Front-End (`/front-end`)
A sleek, modern administration dashboard and respondent interview interface.
*   **Admin Dashboard (`/survey_admin`):** Allows you to monitor response counts in real-time, toggle the survey open or closed, trigger the AI analytics pipeline, and view the final generated report.
*   **Respondent Interface (`/adaptive-interviewing`):** The client-facing site where users actually take the survey.

### 2. The Python Orchestrator (`survey_analytics_orchestrator.py`)
This is the "brain" of the operation. When triggered, this script runs in the cloud and performs the following steps:
1.  Fetches raw survey responses from Firestore.
2.  Uses the **Google Gen AI SDK** (Gemini) to categorize responses and extract key themes/opinions.
3.  Simulates a Node.js sandbox to compile data into a portable, single-file HTML visualization.
4.  Publishes the final report to Firebase Storage.

### 3. Cloud Functions (`/functions`)
A small bridge that listens for requests from the admin dashboard and kicks off the Cloud Run job that executes the Python orchestrator.

---

## 🚀 "Click-to-Deploy" Configuration

Deploying your own instance of the Standalone Analytics Platform takes less than 5 minutes. We use Google Cloud Shell to completely automate the provisioning of your infrastructure (Cloud Run, Secret Manager, Artifact Registry) and the deployment of your web app (Firebase).

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/peterwgnd/sensemaking-test.git&cloudshell_tutorial=tutorial.md)

**To Deploy:**
1. **Important:** Edit this `README.md` and replace `YOUR_GITHUB_REPO_URL` in the link above with the actual URL of your repository.
2. Click the button above to launch Google Cloud Shell.
3. A tutorial panel will open on the right side of your screen. Simply click the "Run" icon next to the `./setup.sh` command inside the tutorial!
4. The script will ask for your email (to make you an Admin) and your Gemini API Key. It will handle everything else automatically!

### 🔑 Gemini API Key
The orchestrator relies on the `google-genai` SDK to talk to Gemini. To avoid hardcoding keys or managing complex IAM permissions for simple deployments:
*   The system expects your API key to be available in an environment variable named `GOOGLE_API_KEY`.
*   When deploying the Cloud Run job, you should inject this key as an environment variable in the job configuration.

### 🪣 Firebase Storage Rules
If you are using custom buckets or multi-bucket setups (like separate buckets for audio and reports), make sure your Firebase Storage rules are flexible enough to cover the default bucket where reports are stored. 
Use a wildcard match like `match /b/{bucket}/o` to ensure the rules apply to all assets!

### 📊 Firestore Database
The system is configured to target a Firestore database named **`standalone`** explicitly (rather than the default instance) to keep survey data isolated and organized.

---

## 🛠️ Testing Locally

If you want to run the pipeline manually from your machine to test it:

```bash
# Set your query parameters
python survey_analytics_orchestrator.py -s YOUR_SURVEY_SLUG -o /tmp
```

Make sure you have run `pip install -r requirements.txt` and have your `GOOGLE_API_KEY` set in your terminal before running!

---

Happy Surveying! 🚀
