# PRD: Open-Source "Survey-in-a-Box" Ecosystem (Click-to-Deploy)

Continuing from Conversation df3aecdc-55f1-480b-a51b-b860d81efc2c

## Overview
Shifting the platform strategy to an Open-Source, self-hosted deployment model. An administrator can pull a GitHub repository, click a Terraform "Deploy to Google Cloud" button, and spin up an isolated instances of a custom Gemini-powered survey system in minutes. All heavy analytics are scoped within a single GCP account for zero friction configuration (no GitHub Action keys required).

## Core Requirements

### 1. Master Admin Dashboard: Survey Creator
- **Action**: "Create New Survey" button.
- **Form Interface**:
  - **Survey Name**: Human-readable name (and slug used for URLs).
  - **Questions List**: Add/Remove multiple questions in a sequence.
  - **Task Prompt text area**: Define the `{task_prompt}` instructions used by Gemini for follow-ups.
  - **Report UI Config Defaults (Optional)**: Set defaults for `overview_chart` (toggle, topics, opinions), `number_of_top_opinions`, `number_of_sample_quotes`, and `chart_colors`.
- **Save State**: Pushed to a standard `surveys` configuration collection in Firestore. 
- **Instant Live URLs**: Since the site uses SPA-style client routing, new survey links are live the microsecond save is clicked (no builds).

### 1.1 Master Admin Dashboard: List View Separation
- **UI Structure**: Split the main admin page (`/admin`) into two distinct sections: "Interactive Surveys" and "Uploaded Data".
- **Interactive Surveys**: Lists items where `type != "uploaded"`. Cards should show performance metrics and buttons to manage or take the survey.
- **Uploaded Data**: Lists items where `type == "uploaded"`. Cards are simplified and should show the title and ONLY a button to "Generate Report" (opening the report configuration modal).
- **Code Generalization**: Move the Report Modal markup and the JavaScript handling form submission/polling (currently in `survey_admin.js`) into a global or shared module so it can be accessed from both the main dashboard list and the specific survey page.

### 1.2 Upload Data Validation & Mapping
- **CSV Header Requirement**: The analytics orchestration pipeline strictly requires the input CSV to have column headers named `participant_id` and `survey_text`.
- **Client-Side Validation**: When a file is selected in the "Upload Data" modal, the frontend (using PapaParse) should read the first row of headers.
- **Failback Mapping UI**: If the required headers are missing, the modal should display dropdowns populated with the found headers, allowing the user to specify which column corresponds to "Participant ID" and which corresponds to "Survey Text".
- **Silent Transformation**: On form submit, the frontend (using PapaParse) should process the file, rename the mapped columns to the required names, and upload the *transformed* CSV to Firebase Storage. This ensures the backend orchestrator always receives a standardized file format.

### 1.3 Survey & Data Deletion
- **UI Triggers**: 
  - On the Main Dashboard (`/admin`), each survey card (both interactive and uploaded) should have a "Delete" button.
  - On the Survey-Specific Admin Page (`/admin/[survey-slug]`), there should be a prominent "Delete Survey" button in the control panel.
- **User Confirmation**: Clicking the delete button must trigger a browser `confirm()` or modal warning the user: "This will permanently delete the survey, all participant responses, and all generated reports. Are you sure?"
- **Backend Execution (Firebase Function)**: Because client-side deep deletion (subcollections and storage folders) is insecure and unreliable at scale, deletion must be handled by a secure Firebase Callable Function (e.g., `deleteSurvey`).
- **Deletion Targets**:
  1. **Firestore**: The main survey document at `surveys/{slug}`.
  2. **Firestore Subcollection**: All documents within `surveys/{slug}/responses/` (this also handles pre-generated tokens).
  3. **Cloud Storage**: All files in the `reports/{slug}/` directory (generated reports, intermediate CSVs, and `.checkpoints/`).
  4. **Cloud Storage**: All files in the `uploads/{slug}/` directory (if this was an uploaded survey).
- **Concurrency & Cancel Functionality (Prerequisite)**: If a Cloud Run analytics pipeline is running for a survey, deleting the survey mid-flight could cause orphaned data writes or crashes. Therefore, a "Cancel Pipeline" functionality must be implemented *first*. The deletion routine will reuse this cancel function to ensure any active jobs are terminated before proceeding with data deletion.
- **Large-Scale Deletion Capabilities**: To prevent timeouts when deleting surveys with thousands of responses, the Firebase Function must use the Admin SDK's `BulkWriter` for Firestore subcollections and `bucket.deleteFiles({ prefix: ... })` for Cloud Storage directories to execute bulk deletions efficiently.
- **Post-Deletion Redirect**: If deleted from the Survey Admin page, the user should be redirected back to the Main Dashboard. If deleted from the Dashboard, the survey card should be removed from the DOM.

### 1.4 Pipeline State Machine & UI Behaviors
To provide clear feedback and robust control over the Cloud Run analytics pipeline, the "Generate Report" button on the survey cards and admin page will act as a dynamic state machine reflecting the current `telemetry` status in Firestore:
- **State: NOT STARTED**:
  - **Button**: "Generate Report"
  - **Action**: Opens configuration modal, creates a fresh job.
- **State: RUNNING**:
  - **Button**: "Cancel" (Primary action)
  - **Action**: Triggers a new Firebase Callable Function (`cancelPipeline`) which uses the Cloud Run API to forcibly terminate the active job execution for this survey.
- **State: CANCELING**:
  - **Button**: "Canceling..." (Disabled)
  - **Action**: Waiting for the backend to confirm the job execution has been terminated.
- **State: FAILED or CANCELED (With Checkpoints)**:
  - **Button**: "Resume"
  - **Action**: Bypasses the configuration modal (using previous settings) or allows editing, but explicitly tells the Cloud Run job to pull `.pkl` checkpoints from Storage and resume where it left off.
- **State: COMPLETED**:
  - **Button**: "Regenerate Report"
  - **Action**: Opens the configuration modal. If submitted, sends a `purge_checkpoints: true` flag to the orchestrator. To prevent abandoned artifacts or orphaned files from consuming storage, the orchestrator (or Firebase Function) will execute a hard physical delete of the entire `reports/{surveySlug}/data/` directory in Cloud Storage before beginning Step 0, guaranteeing a completely clean slate.

**Crucial Considerations**:
- **Zombie State Prevention**: If a Cloud Run container crashes abruptly (e.g., Out Of Memory or hard timeout), it will not have the chance to write a "Failed" status to Firestore, leaving the UI permanently stuck in the "RUNNING" state. The frontend or Firebase functions must have a reliable way to verify if the job is actually still running (e.g. querying the Cloud Run API, or utilizing a Cloud Scheduler heartbeat, or simply treating a state with no updates for X minutes as dead).

### 2. Survey Experience (`/[survey-slug]/survey`)
- **Multi-question loop**:
  - Loop through Question N:
    - **Step A**: Display Question N. User answers AN.
    - **Step B**: AI generates a follow-up question FN using custom `{task_prompt}`.
    - **Step C**: Display Follow-up question FN. User answers AFN.
    - **Step D**: Move to Question N+1.
- **Access Control Status**: If survey state is `closed` in Firestore, access is denied. 
- **Session Continuation (Cross-Device)**: The `token` ID acts as a document ID for the response session. If a user closes a tab and visits on a new device with the same link, it reads existing state from Firestore and lets them continue from where they left off (No Logins needed!). It locks once they finish the final question.


### 3. Survey-Specific Admin Page (`/admin/[survey-slug]`)
- **Open/Closed Status Toggle & Question Locking**: Once a survey goes live or takes its first response, questions are locked from edits to prevent downstream misalignment in extraction metrics.

- **Token Manager**: Pre-generate unique tokens and audit visits.
- **"Generate Report" Config Modal**: Triggers a detailed configuration modal before initiating the heavy ETL generation job. The modal is split into three core sections:
  - **1. Basic Options**: 
    - `model_name`: A dropdown to select the AI model to use (passed to both `categorization_runner` and `generate_report_text`).
    - `additional_context`: A textarea to append contextual instructions to prompts (passed to both scripts).
  - **2. Categorization Options**: 
    - `topics`: A text field for a comma-separated list of predefined topics (passed to `categorization_runner`).
    - `skip_autoraters`: A toggle to skip evaluation passes, defaults to `true` (passed to `categorization_runner`).
    - `skip_quote_extraction`: A toggle to skip quote truncation, defaults to `false` (passed to `categorization_runner`).
  - **3. Report Options**: 
    - *Existing UI overrides*: `logo`, `overview_chart`, `number_of_top_opinions`, `number_of_sample_quotes`, `excludedTopics`, chart colors, layout overrides.
  > [!NOTE]
  > Shifted out of the initial creation intake form to prevent friction! They now live exclusively inside this survey-specific dashboard right before you click "Generate".
- **Heavy ETL Report Generation**:
  - Uses the Node.js visualization templates defined in `/src/report_ui` for report output (Read-only, shared with team).
  - Button triggers a **Google Cloud Run Job** (Isolated container context).
  - Wakes up a Python container instance (scales for multiple hours).
  - Passes participating questions/answers to heavy Gemini workflows.
  - Returns a stand-alone, **Portable Visualization HTML file** (D3 visual bundle) and pushes it via Firebase Admin SDK straight to Firebase Hosting bucket as `/[survey-slug]/report`. 
  - **Downloadable Checkpoints (Resumability & Audit)**: Outputs intermediate files (readable `.csv`, `.json`, or `.pkl` checkpoints and payloads) to **Firebase Storage / Cloud Storage**. These are secured by Firebase Auth rules and made visible in the Survey Admin UI for easy download, auditing, and troubleshooting.
  - **Job Progress Tracking**: The Cloud Run Job writes its % complete state/logs back to Firestore. The Admin UI renders this in real-time so users see a loading bar and don't double-click.


### 4. Security & Authentication (Admin Only)

To ensure this "Click-to-Deploy" system remains completely secure and restricted strictly to the instance owner, we will implement the **Environment Variable Seed** pattern.

- **4.1 Terraform Initialization**: During deployment, the user provides a comma-separated list of emails (e.g., `admin_emails = "user1@domain.com,user2@domain.com"`). Terraform injects this into the Cloud Functions environment as `ADMIN_EMAILS`.
- **4.2 Auth Trigger (Custom Claims)**: We will write a Firebase Auth Trigger function (e.g. `onUserCreated`). When a user signs in with Google, the function checks if their `user.email` exists in the `ADMIN_EMAILS` string. 
  - If it matches, the function attaches a Custom Claim `{ admin: true }` to their Auth Token. 
  - If it does not match, the function instantly deletes the user account or blocks the sign-in, completely locking down the platform to authorized users only.
- **4.3 Backend Security Rules Enforcements**:
  - `firestore.rules` and `storage.rules` will be rewritten. Currently, they allow any authenticated user to write data (`if request.auth != null;`). They must be updated to explicitly check the custom claim: `if request.auth != null && request.auth.token.admin == true;`.
  - All Firebase Callable Functions (e.g., `triggerAnalyticsPipeline` and `deleteSurvey`) must extract `context.auth.token.admin` and throw an Unauthenticated error if false.
- **4.4 Frontend Route Protection**: `global_auth.js` will be updated to not only check `if (user)`, but to actively fetch the token claims (`await user.getIdTokenResult()`) and verify the `.admin` boolean before rendering the dashboard DOM.
- **4.5 Future Role Management**: To prevent locking the user into having to edit environment variables for future team members, the `ADMIN_EMAILS` variable acts as a *Seed*. We can add a "Team Management" tab to the Admin Dashboard later that allows the Seed Admin to add additional emails to a protected `roles/admins` Firestore document. The Auth Trigger will then check *both* the environment variable and this Firestore document to determine if a new sign-in should be granted the `admin` claim.

---

## Technical & Architectural Considerations (Self-Hosted Vision)

### A. Execution Environment: Pure Google Cloud (No GitHub bridges)
Running long-standing Python scripts (hours) forces us into **Cloud Run Jobs** (24h limit auto-scaling). 
- Keeps compute isolated natively in a single GCP project.
- Terraform sets up Service Account permissions out of the gate with zero third-party setups. 

### B. Client Routing Architecture (Spa Style)
We will leverage **Firebase Hosting Rewrites** (`** -> /survey.html`) to enable clean URLs without requiring a dynamic node engine or rebuild. One static file handles all dynamic survey views.

### C. Polyglot Report Dispatcher
We will preserve the Node.js/npm dependencies inside the Cloud Run Job Docker container. This ensures we can reuse the UI team's `/src/report_ui` build scripts entirely untouched. The Python orchestrator will copy data payloads into the UI folder and trigger `npm run inline` via subprocess.

### D. Workspace Constraints
- **Read-Only `/src/`**: Shared Python analysis scripts and UI templates are located in `/src/`. **Do not modify these files** to avoid conflicting or confusing other teams working on the Python side.

### E. Real-Time UI Performance (Firestore docChanges)
- **Delta-Based Updates**: The admin dashboard (`admin.js`) uses Firestore's `docChanges()` to update only the specific cards that change, rather than re-rendering the entire list. This ensures high performance as the number of surveys grows and preserves UI state (focus, selection) during live updates.

### F. Future Click-to-Deploy Portability (Dynamic Firebase Config)
- **Problem**: Hardcoded Firebase configuration in `firebase-config.js` prevents seamless "click-to-deploy" setups for multi-tenant or open-source distribution.
- **Solution**: In future iterations, abstract the hardcoded config by fetching it dynamically from Firebase Hosting's reserved `/__/firebase/init.json` endpoint. This will eliminate the need to bake credentials into the build artifact and support multi-project deployments automatically.

---

## 4. Derived Schema and Routing Architecture (Decisions)

### A. Firestore Schema Design
- **Config Registry Collection: `surveys`**:
  - `id`: Slug (`[survey-slug]`)
  - `title`: String
  - `questions`: Array of Strings
  - `taskPrompt`: String
  - `status`: String (`"open"` or `"closed"`)
  - `config`: Object (colors, layout rules, logos)
- **Response Tracking Isolation: `responses_[surveySlug]`**:
  - Each document represents a participant answers session. Captures `participant_id`, `question_text` tracking map, `answers`, and generated AI follow-ups for future auditing. For data extraction, all answers for a single participant are concatenated into a single `survey_text` CSV row.

- **Session Access Keys Tracking: `tokens`**:
  - `id`: `[token-id]`
  - References `surveyId`. Status tracking for continuity.

### B. Routing `firebase.json` Design
Leverage standard Single-Page App rewrites:
- `/:slug/survey` ➔ `/adaptive-interviewing/index.html` (Points to generic eleventy template).
- `/admin/:slug` ➔ `/survey_admin/index.html` (Points to generic single-survey dashboard).
- `/[slug]/report` ➔ Output static HTML from Cloud Run Jobs.



---

## 5. Implementation Roadmap (Phases & Detail Checklist)

### 🎬 Phase 1: Foundation & Static SPA Routing (Zero-Friction setup)
- [x] Configure `firebase.json` rewrites to point clean clean URL paths to their generic templates:
  - `/:slug/survey` ➔ `/adaptive-interviewing/index.html`
  - `/admin/:slug` ➔ `/survey_admin/index.html`
- [x] Confirm local node/npm context works (Add action items to `meatlog.md` if failing).

### 📝 Phase 2: Master Admin (The Intake Form & Upload Flow)
- [x] Create UI for "Create New Survey" Modal in `/admin/index.njk`.
- [x] Add Form Inputs for: Name, N-Questions (Add/Remove items), Task Prompt Textarea.
- [x] Add "Survey Mode" Toggle (Integrated Survey vs Upload Raw Data CSV).
- [x] If Upload Mode: Allow uploading a CSV file securely to Firebase Storage.
- [x] Connect clicks in `/scripts/admin.js` to push this configuration object (including a `type` flag and `file_uri` if uploaded) to a central `surveys` collection in Firestore.

### 🎤 Phase 3: Dynamic Multi-Question Survey Loader (The Experience)
- [x] Update `/scripts/interview.js` UI hydration: instead of hardcoded questions, it reads the URL parameters, pulls the question array from Firestore `surveys/{surveySlug}`, and renders Question 1.
- [x] Single use token interception: Read query parameters, authenticate document existence (or lock session if finished).
- [x] Transition loop (Client side state machine and Cloud Functions triggers completed!).

### 📊 Phase 4: Conversation-Specific Admin Panel
- [x] Build generic `/survey_admin.html` loading metrics isolating data for `{surveySlug}`.
- [x] Implement Open/Closed toggles and locks.
- [x] Provide "Generate Token" button (creates unburnt key documents in Firestore, supporting multiple generations!).
- [x] "Generate Report" button: Triggers a comprehensive config modal with Basic Options (Model, Context), Categorization Options (Topics, Skips), and Report Options (UI settings).
- [x] On modal submit, update the Cloud Function to parse the new modal configuration and pass the command line arguments to the Cloud Run job overrides.

### 🤖 Phase 5: Heavy Analytics Pipeline (Python Cloud Run Job)
- [x] Wrap `/src/categorization_runner.py` + `/src/generate_report_text.py` into an orchestrating python script (Read-only source, do not modify). Connect it with `checkpoint_utils.py`.
- [x] Update orchestrator initialization to dynamically load its input: If `type == 'integrated'`, compile responses into CSV from Firestore. If `type == 'uploaded'`, download CSV directly from Firebase Storage.
- [x] Connect web trigger to unblock Cloud Run Jobs execution (passing the Survey Slug).
- [x] Integrate Job Progress tracking updates (sending `% complete` telemetry to Firestore).
- [x] Output portable HTML directly to GCS/Firebase Hosting (via orchestrating the `src/report_ui` Node build scripts).
- [x] Save intermediate readable checkpoints (e.g., `.csv`, `.json`) and report JSON inputs to Firebase Storage for secure admin downloads.

---

## G. Checkpoint Handling & Recurring Runs (Future Considerations)

To support the use case of running the pipeline repeatedly as new data comes in, the following scenarios must be considered for future implementation:

1. **Failed previously, No new data**: Proceed from checkpoints (current behavior). This is the standard resumability feature.
2. **Failed previously, New data**: Defer to user. We should provide a prompt or checkbox in the "Generate Report" modal letting the user decide whether to resume from the last checkpoint or start over with the full dataset.
3. **Succeeded previously, No new data**: Alert user before they waste tokens on generating an identical report.
4. **Succeeded previously, New data**: Delete checkpoints automatically and start fresh with the new data.
5. **Configuration/Prompt Changes**: Using old checkpoints could produce inconsistent results if the prompt or settings have changed, prompt or warn user before proceeding.
6. **Historical Versioning vs. Overwriting**: Consider whether to support historical versions of reports. If the user wants to see evolution over time, we should keep old reports and create new numbered/dated ones instead of overwriting.

---

## H. Known Issues

### ~~1. `NameError` in `genai_model.py` during 429 Error Handling~~ [FIXED]
- **Description**: The function `_extract_error_details` in `src/models/genai_model.py` attempts to use the variable `log_prefix` on lines 212 and 217, but `log_prefix` is neither passed as an argument nor defined within that function's scope.
- **Trigger**: This bug is triggered when handling `429 Too Many Requests` (Quota Exceeded) errors, specifically when the error details do not contain retry info or fail to parse.
- **Impact**: It causes the orchestration pipeline to crash with a `NameError` instead of backing off and retrying as intended when hitting rate limits.

---

## I. Phase 6: Implementation Plan (Next Steps)

This section outlines the logical build order for implementing the new Pipeline State Machine, Survey Deletion, and Authentication features. 

### Step 1: Cancel Functionality & Zombie Prevention (Backend)
- [x] **The Cancel Function**: Write a new Firebase Callable Function (`cancelAnalyticsPipeline`) in `functions/index.js`. This function will use the Google Cloud Run API (`@google-cloud/run`) to look up the active execution for the survey and forcefully terminate it (`executions cancel`).
- [x] **Zombie Detection**: Add logic to check if a job marked as "Running" in Firestore is actually dead (e.g., the container crashed from an OOM error). This ensures the UI doesn't get permanently stuck if a job dies silently.

### Step 2: The Dynamic Button State Machine (Frontend)
- [x] **Button Refactor**: Update the "Generate Report" button logic in `pipeline_controller.js` to act as a dynamic state machine. It will change to "Cancel" when running, "Resume" if failed with checkpoints, and "Regenerate Report" when complete.
- [x] **The Purge Flag**: Modify the UI modal so that clicking "Regenerate Report" passes the `purge_checkpoints: true` flag to the Cloud Function, and update the Cloud Function/Python Orchestrator to physically delete the `reports/{surveySlug}/data/` directory before starting.

### Step 3: The Deep Deletion Engine (Backend & Frontend)
- [x] **The Delete Function**: Write the `deleteSurvey` Callable Function in `functions/index.js`. We will use the Firebase Admin SDK's `BulkWriter` to delete the `responses` subcollection and `bucket.deleteFiles` to wipe out the Storage buckets safely without timing out.
- [x] **UI Binding**: Add the "Delete Survey" buttons to the survey admin page and dashboard cards, hook them up to a `confirm()` modal, and wire them to our new `deleteSurvey` function.

### Step 4: Security & Authentication (Deferred)
- **Env Var Setup**: Integrate the `ADMIN_EMAILS` variable configuration in the deployment.
- [x] **Auth Triggers**: Write the `syncAdminClaims` trigger to assign custom claims (`admin: true`) or delete unauthorized sign-ups.
- **Lockdown**: Rewrite `firestore.rules`, `storage.rules`, and update the frontend router and backend functions to explicitly verify the `admin: true` claim.

---

## H. Identity & Access Management (IAM) Implementation Plan

The platform relies on a strict separation of concerns between **Global Administrators** (who manage the platform) and **Survey Respondents** (who only participate in specific surveys).

### 1. Global Admin Management (Main Dashboard)
Admin access is granted platform-wide. Admins can see all surveys and invite other admins.
- **Backend (Cloud Functions)**:
  - [x] **(Completed)** The `syncAdminClaims` Cloud Function already exists to grant the `admin: true` custom claim to users in the `admin_users` collection.
  - (Optional) Create an `inviteAdmin` callable function to send email invites.
- **Frontend (Dashboard)**:
  - Add a `/dashboard/users` route, protected by a Svelte routing guard checking the `admin: true` claim.
  - Implement a data table displaying current admins. **Because you have the `admin_users` collection in Firestore, your UI can securely query this collection directly!** You don't need a `listAdmins` Cloud Function.
  - Add a modal to invite new admins (writes to the `admin_users` collection).

### 2. Respondent Management (Survey-Specific Admin)
Respondent access is scoped strictly to the survey level. Mixing respondent data into global Firebase Auth is an anti-pattern.
- **Data Model**: Store respondents as a subcollection under the specific survey: `surveys/{surveySlug}/respondents/{respondentId}`.
- **Backend (Cloud Functions)**:
  - Create a `generateSurveyTokens` callable function to batch-create single-use access links.
- **Frontend (Survey Admin)**:
  - **Invite-Only Toggle**: Add a toggle in the survey settings to "Require Valid Token". By default, surveys remain public (allowing the current `anonymous-UUID` fallback). When toggled on, the backend validation is strictly enforced.
  - Add a "Participants" or "Tokens" tab to the `/dashboard/surveys/[slug]/admin` page.
  - **Bulk Generation & Export**: Provide UI to generate tokens in bulk (e.g., input "1000" tokens) and a button to **Export to CSV**. This allows admins to download a spreadsheet of thousands of URLs to use in a Mail Merge or mass email tool.
  - Display metrics on which tokens have been claimed vs. unburnt.

### Key Architectural Considerations
1. **The 1000-Byte Limit:** Never use Firebase Custom Claims (`admin.auth().setCustomUserClaims`) to store survey-level permissions (e.g., trying to save `allowed_surveys: ['survey1', 'survey2']` on a user object). Claims have a strict 1000-byte limit and will break. Custom Claims are *only* for the boolean `admin: true` global flag.
2. **Anonymous Respondents:** Respondents should ideally not have full Firebase Auth accounts (with emails/passwords). They should authenticate seamlessly via a single-use token in their URL. You can use Firebase Anonymous Auth under the hood to secure their session without bloating your Auth database with thousands of one-time participant accounts.
3. **Data Silos:** Firestore Security Rules must ensure that a respondent authenticated via a single-use token can *only* write to their specific response document and absolutely cannot read other responses or global survey metrics.

---

## I. Embeddable Web Component Architecture & Implementation Plan (Click-to-Deploy Multi-Site Support)

### 1. Vision & Click-to-Deploy Alignment
A central goal of the "Survey-in-a-Box" click-to-deploy ecosystem is enabling self-hosted administrators (such as municipal agencies, civic tech organizations, or researchers) to deploy a single GCP/Firebase instance and seamlessly run surveys across **any number of third-party websites they manage** (e.g., `nyc.gov`, `dot.nyc.gov`, `parks.nyc.gov`).

To achieve this without requiring host server modifications, complex build-tool integration, or CORS/CSP headaches, the survey component is packaged as an embeddable HTML5 Web Component (`<wtp-survey>`) backed by an auto-resizing iframe wrapper.

### 2. Core Architectural Decisions

1. **Embed Architecture: Iframe-Backed Web Component Wrapper**
   - **Pattern**: The host webpage loads a 1KB static script (`/static/embed.js`) which registers the `<wtp-survey>` Custom Element. This custom element renders a borderless, transparent `<iframe>` pointing to the self-hosted Svelte app (`https://survey.nyc.gov/embed/widget...`).
   - **Why It Preserves Click-to-Deploy Simplicity**:
     - **Zero CORS / Firebase Domain Friction**: Because the iframe document runs under the self-hosted app's origin (`survey.nyc.gov`), 100% of Firebase Auth/App Check requests originate from an already-authorized domain. Admins never need to reconfigure Firebase Console for each municipal target site.
     - **Zero CSP `connect-src` Friction**: Host website IT teams only need to allow framing (`frame-src https://survey.nyc.gov;`), rather than whitelisting Google Cloud and Firestore API endpoints in their Content Security Policy.
     - **100% CSS & Font Isolation**: Prevents host website global CSS resets (e.g., WordPress or Bootstrap table/button styles) from breaking Tailwind layouts, and prevents Svelte styles from leaking into the host page.
   - **Zero-Scrollbar Auto-Resizing**: The embedded Svelte app sends real-time `postMessage({ type: 'resize', height: 420 })` events to the parent Custom Element wrapper, smoothly animating iframe height as questions change or error messages appear.

2. **Multi-Survey Queue Mode (`mode="queue"`)**
   - **Single Mode** (`slug="xyz"`): Collects responses for an individual survey and displays a thank-you screen upon completion.
   - **Queue Mode** (`mode="queue"`): Chaining open surveys together for participants across multiple sites. By default, it queries Firestore for all surveys where `status == 'open'`, filters out any survey where the respondent's token has already submitted a response in `responses/{tokenId}`, and transitions sequentially through unanswered surveys.
   - **Overrides**: Supports optional `slugs="s1,s2"` or `tag="transportation"` attributes to scope the queue to a curated playlist.

3. **Wrapper Script Implementation: Lightweight Vanilla JS (`/static/embed.js`)**
   - Implemented as a ~50-line Vanilla JavaScript class (`class WTPSurvey extends HTMLElement`) in `front-end/static/embed.js`.
   - Requires **zero build-step complexity** (no secondary Vite configs or bundle dependencies) and executes instantly on any host webpage (~1KB footprint).

4. **Admin UI Generator: Unified Dashboard Embed Modal**
   - Centralizes snippet generation in a single **"Embed Surveys"** button on the Main Admin Dashboard (`/admin`).
   - Provides checkboxes to select a single survey, multiple surveys, or all open surveys, alongside visual theme/font controls and an optional "Allowed Embed Domains" allowlist stored in Firestore.

---

### 3. Step-by-Step Implementation Roadmap

#### Step 1: The Lightweight Vanilla JS Embed Wrapper (`/static/embed.js`)
- [ ] Create `front-end/static/embed.js` defining `class WTPSurvey extends HTMLElement`.
- [ ] Implement attribute parsing for `slug`, `mode`, `slugs`, `tag`, `theme`, and `font`.
- [ ] Create the borderless iframe element pointing to `/embed/widget` with URL search parameters.
- [ ] Add the `window.addEventListener('message', ...)` listener to dynamically adjust `iframe.style.height` upon receiving resize telemetry from the embedded Svelte app.

#### Step 2: The Embeddable Survey Route (`front-end/src/routes/embed/widget/+page.svelte`)
- [ ] Create a dedicated embed route in SvelteKit stripped of headers, footers, and page margins.
- [ ] Implement a ResizeObserver / layout effect that sends `window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*')` whenever DOM height changes.
- [ ] Support dynamic font loading (Google Fonts auto-injection or custom CDN stylesheets via `font-url`) and CSS variable theming (`theme`, `primary-color`).
- [ ] Add an origin guard check against `document.referrer` / `window.location.ancestorOrigins` if an `allowedEmbedDomains` list is configured on the survey document in Firestore.

#### Step 3: Multi-Survey Queue Controller (`mode="queue"`)
- [ ] Create a queue controller state machine for `mode="queue"` in the embed route.
- [ ] Query Firestore for open surveys (`status == "open"`), optionally filtered by `slugs` or `tag`.
- [ ] Check existing `/surveys/{slug}/responses/{tokenId}` documents for the current respondent token and filter out completed surveys.
- [ ] Seamlessly transition the interview loop to the next unanswered survey when the current survey completes.

#### Step 4: Unified Dashboard Embed Modal (Admin UI)
- [ ] Add an **"Embed Surveys"** button on the Main Admin Dashboard (`/admin`).
- [ ] Create the Embed Generator Modal with:
  - Checkboxes for selecting individual surveys, multiple surveys, or "All Open Surveys".
  - Styling controls (`theme`, `font`).
  - A text input for "Allowed Embed Domains" (saved to Firestore `admin/metadata` or survey config).
  - A live-updating HTML snippet preview (`<script src="...">` + `<wtp-survey ...>`) with a one-click Copy button.

#### Step 5: IT Administrator Embed Checklist & CSP Documentation
- [ ] Include an "IT Checklist" tab in the Dashboard Embed Modal showing the minimal CSP header required (`frame-src https://your-domain.com;`) so self-hosted admins can easily hand it to target website IT coordinators.