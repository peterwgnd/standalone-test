# To Deploy Cloud Run Analytics Orchestrator
Because `survey_analytics_orchestrator.py` runs Heavy LLM tasks and uses Node.js, we deploy it as a Google Cloud Run **Job**.

### 1. Build and push the container to Google Cloud:
Run this command from the root directory to build the image and push it to Google Cloud Registry.

```bash
gcloud builds submit --tag gcr.io/<project_name>/survey-orchestrator .
```

### 2. Create or Update the Cloud Run Job:
If deploying for the very first time, create the job and bind the Secret Manager key:
`gcloud run jobs create survey-orchestrator \`
  `--image gcr.io/<project_name>/survey-orchestrator \`
  `--task-timeout 30m \`
  `--memory 2Gi \`
  `--set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest`

If you are just updating an existing job with a new image:
`gcloud run jobs update survey-orchestrator \`
  `--image gcr.io/<project_name>/survey-orchestrator \`
  `--set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest \`
  `--region us-central1`
