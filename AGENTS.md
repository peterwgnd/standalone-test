# AI Agent Instructions

You are an expert full-stack developer working on this standalone analytics platform. Read and strictly adhere to these rules before writing or modifying any code.

## Project Overview

This repository contains a standalone web application designed for analytics and opinion data processing. The architecture consists of:
1.  **Frontend**: A Svelte web interface (`front-end/`).
2.  **Backend/Functions**: Firebase Cloud Functions (`functions/`).
3.  **Data Processing**: A Python-based analytics orchestrator (`survey_analytics_orchestrator.py`) deployed as a Google Cloud Run Job. This orchestrator handles heavy LLM tasks and data generation.

## Repository Boundaries & Rules
- **Frontend Code**: All UI code should be written in Svelte within the `front-end/` directory.
- **Backend Infrastructure**: Firebase is used for data storage (Firestore) and lightweight backend operations (`functions/`). 
- **No Direct API Keys in Frontend**: Ensure the Svelte front-end only uses Firebase App Check and standard Firebase Web SDK features. Do not leak Google Cloud or Gemini API keys.
- **Google Style Guide**: All Python code must strictly follow standard [Google Python Style conventions](https://google.github.io/styleguide/pyguide.html). 

## Architecture & Tech Stack

### 1. Data Orchestration (Python)
- The heavy lifting is done by `survey_analytics_orchestrator.py` which interacts with Firestore and executes complex data processing tasks.
- It is deployed using the `Dockerfile` at the root of the project. 
- **Note**: The Dockerfile automatically clones the upstream `src/` logic from the Jigsaw-Code/sensemaking-tools repository during the build. The orchestrator script natively expects this.

### 2. Web Interface (Svelte)
- The frontend is built using SvelteKit. Follow Svelte best practices when modifying or adding components in `front-end/src/`.
- Use standard CSS for styling. Avoid inline styling unless absolutely necessary. Try to use existing components as much as possible. Keep an eye on opportunities to abstract new patterns to components and CSS variables to assist future users in customizing the interface.

### 3. Google Cloud & Firebase
- We heavily utilize Google Cloud Services and Firebase. Ensure any new dependencies added to `requirements.txt` or `package.json` are compatible with Cloud Run and Firebase Functions respectively.

## Executable Commands
Use these exact commands when verifying your work. Run them from the project root.

*   **Install frontend dependencies:**
    ```bash
    cd front-end && npm install
    ```
*   **Run frontend dev server:**
    ```bash
    cd front-end && npm run dev
    ```

## Agent Workflow
1. When asked to modify UI components, work within the `front-end/` directory.
2. When asked to modify data storage rules or lightweight cloud operations, check `firebase.json`, `firestore.rules`, and `functions/`.
3. When asked to modify the data analysis pipeline, focus on `survey_analytics_orchestrator.py` and the `Dockerfile`.