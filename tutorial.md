# Welcome to the Standalone Analytics Platform!

This tutorial will guide you through deploying your platform to Google Cloud. We have completely automated the provisioning of your infrastructure and the deployment of your web app.

## Deploy the Platform

When you are ready, click the 'execute' icon on the code snippet below to start the setup script.

```bash
./setup.sh
```

The script will prompt you for three things:
1. **Google Cloud Project ID**: The Google Cloud project where you want to deploy the resources (Press Enter to use your currently active project).
2. **Your Email**: This will be used to make you the Admin of the application.
3. **Gemini API Key**: This securely powers the AI backend orchestrator.

Sit back and relax! The deployment will take roughly 3-5 minutes. Once finished, it will output the URL of your live dashboard.
