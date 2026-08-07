# Code Reviewer Guide: Standalone Sensemaking AI

Welcome! This guide provides a high-level architectural walkthrough, security model overview, and a recommended review path to help you navigate the codebase efficiently.

---

## 1. System Architecture & Component Map

The platform is designed as a **self-hosted, click-to-deploy analytics and adaptive survey ecosystem** deployed entirely within a single Google Cloud Platform / Firebase project.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT BROWSER                                  │
│  • Respondent Portal: /[slug]/survey (Anonymous / Token-based)              │
│  • Administrator Dashboard: /dashboard & /admin/[slug] (Google Auth + Admin)│
└───────────────────────┬─────────────────────────────▲───────────────────────┘
                        │ HTTPS (SvelteKit SPA)       │ Realtime Firestore
                        ▼                             │ Telemetry & Updates
┌─────────────────────────────────────────────────────┴───────────────────────┐
│                       FIREBASE / GOOGLE CLOUD                               │
│                                                                             │
│  1. Cloud Functions v2 (/functions/src/)                                    │
│     • followUp.js: onDocumentWritten Firestore trigger + Gemini 3.5 Lite    │
│     • pipeline.js: Cloud Run v2 Job dispatcher, cancellation & zombie check │
│     • deletion.js: Pre-cancel job -> Storage prefix purge -> recursiveDelete│
│     • auth.js: Bootstrap seed -> Firestore trigger claims sync (admin: true)│
│     • tokens.js: High-throughput BulkWriter respondent token minting        │
│                                                                             │
│  2. Cloud Run Analytics Job (/orchestrator/survey_analytics_orchestrator.py)│
│     • Pulls responses from Firestore or CSV from Cloud Storage              │
│     • Dispatches topic clustering & Gemini text summarization (/src/)       │
│     • Sandboxes and builds offline D3 visualization HTML (/src/report_ui)   │
│     • Uploads checkpoints (.pkl) and final report.html to Cloud Storage     │
│                                                                             │
│  3. Database & Object Storage                                               │
│     • Firestore: Database "standalone" (surveys, responses, respondents)    │
│     • Cloud Storage: gs://<project>.appspot.com/reports/<slug>/...          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Principles & Invariants

### A. Dual-Tier Identity & Access Management (IAM)
* **Global Administrators**:
  * Authenticate via Google Sign-In on `/login`.
  * Initial seed admin matches `process.env.ADMIN_EMAIL` $\rightarrow$ provisioned in `admin_users/{uid}` via [`initAdmin`](file:///Users/wiegandp/Desktop/standalone/functions/src/auth.js#L14).
  * The [`syncAdminClaims`](file:///Users/wiegandp/Desktop/standalone/functions/src/auth.js#L78) Firestore trigger attaches `{ admin: true }` custom claim to their Firebase Auth token. Deleting an `admin_users` document instantly revokes the claim.
  * **Claim Size Invariant**: Custom claims are *only* used for the boolean `admin: true` flag to strictly respect Firebase Auth's 1,000-byte claim size ceiling.
* **Survey Respondents**:
  * Scoped strictly to the survey level via single-use tokens stored in `surveys/{slug}/respondents/{token}`.
  * Respondents have **zero read access** to other participants' responses, survey metrics, or admin metadata.

### B. Prompt Injection Defense & Denial-of-Wallet (DoW) Protection
* **XML Tag Isolation**: In [`followUp.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/followUp.js#L24), participant input is encapsulated inside `<user_response>` tags with explicit system instructions to treat the contents strictly as untrusted data.
* **Input Length Bounds**: Both `question` and `answer` lengths are strictly validated ($\le 2,000$ characters) before invoking the Gemini API to prevent prompt token-exhaustion attacks.
* **Idempotency & Concurrency**: Follow-up generation uses `db.runTransaction()` to claim the work atomically (`status: generatingFollowUp_Q...`) and short-circuits if status indicates an active or completed state.

### C. Analytics Pipeline Lifecycle & Zombie Prevention
* **Heartbeat Daemon**: The Cloud Run job runs a background thread ([`TelemetryHeartbeat`](file:///Users/wiegandp/Desktop/standalone/orchestrator/survey_analytics_orchestrator.py#L83)) that writes live progress updates every 60 seconds to Firestore.
* **Zombie Auto-Recovery**: If a Cloud Run container abruptly crashes (e.g. OOM or hard GCP timeout), it cannot write an error state. The frontend and backend treat any job marked running with no updates for $>15$ minutes as a `FAILED_ZOMBIE`, allowing administrators to resume or restart immediately.
* **Clock-Skew Compensation**: [`fetchServerTimeOffset()`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/utils/time.js#L12) reads the HTTP response `Date` header on the client to ensure local device clock drift does not trigger false zombie detections.
* **Stateful Resumability**: Every step in the Python pipeline checks for `.pkl` checkpoints in Cloud Storage. If interrupted, the job skips already-computed LLM steps upon resumption.

### D. Safe Multi-Target Deletion Protocol
* To prevent race conditions where an active Cloud Run job writes orphaned files back to Cloud Storage while a survey is being deleted, [`deleteSurvey`](file:///Users/wiegandp/Desktop/standalone/functions/src/deletion.js#L18) executes a strict 3-phase sequence:
  1. Checks for and forcefully terminates any active Cloud Run execution via `@google-cloud/run` API.
  2. Purges Cloud Storage prefix directories (`reports/{slug}/` and `uploads/{slug}/`).
  3. Recursively wipes the survey document and all subcollections (`responses`, `respondents`, `admin`) via `db.recursiveDelete()`.

---

## 3. Recommended Code Review Path

We recommend reviewing the codebase in the following order:

```
1. Access Rules ──► 2. Cloud Functions ──► 3. Python Orchestrator ──► 4. Frontend Stores ──► 5. UI Views
(firestore.rules)    (functions/src/)       (orchestrator/)            (front-end/src/)       (routes/)
```

### Step 1: Security & Access Rules
* [`firebase-config/firestore.rules`](file:///Users/wiegandp/Desktop/standalone/firebase-config/firestore.rules): Review rule separation between `request.auth.token.admin == true` and public respondent writes.
* [`firebase-config/storage.rules`](file:///Users/wiegandp/Desktop/standalone/firebase-config/storage.rules): Review bucket security policies.

### Step 2: Backend Cloud Functions (`functions/`)
* [`functions/src/followUp.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/followUp.js): Follow-up generation, prompt structuring, DoW limits, idempotency guards.
* [`functions/src/pipeline.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/pipeline.js): Cloud Run job dispatching, container override argument construction, zombie detection.
* [`functions/src/deletion.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/deletion.js): 3-phase deletion engine.
* [`functions/src/auth.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/auth.js): Seed initialization, admin invitation, custom claims synchronization trigger.
* [`functions/src/tokens.js`](file:///Users/wiegandp/Desktop/standalone/functions/src/tokens.js): Token minting and `BulkWriter` ingestion.
* [`functions/index.js`](file:///Users/wiegandp/Desktop/standalone/functions/index.js): Entry point re-exports.

### Step 3: Python Analytics Pipeline (`orchestrator/`)
* [`orchestrator/survey_analytics_orchestrator.py`](file:///Users/wiegandp/Desktop/standalone/orchestrator/survey_analytics_orchestrator.py): 7-phase ETL pipeline, `TelemetryHeartbeat` thread, checkpoint restore/push, sandboxed Node.js D3 build.

### Step 4: Frontend State & Utilities (`front-end/src/lib/`)
* [`front-end/src/lib/utils/pipeline.js`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/utils/pipeline.js): Telemetry state machine evaluator.
* [`front-end/src/lib/utils/time.js`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/utils/time.js): Server clock skew synchronization.
* [`front-end/src/lib/utils/slug.js`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/utils/slug.js): URL slug generation.
* [`front-end/src/lib/stores/authStore.js`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/stores/authStore.js) & [`surveyStore.js`](file:///Users/wiegandp/Desktop/standalone/front-end/src/lib/stores/surveyStore.js): Real-time Firestore sync and optimistic updates.

### Step 5: Frontend Routes & Interfaces (`front-end/src/routes/`)
* [`front-end/src/routes/[slug]/survey/+page.svelte`](file:///Users/wiegandp/Desktop/standalone/front-end/src/routes/%5Bslug%5D/survey/+page.svelte): Multi-question adaptive interview loop.
* [`front-end/src/routes/admin/[slug]/+page.svelte`](file:///Users/wiegandp/Desktop/standalone/front-end/src/routes/admin/%5Bslug%5D/+page.svelte): Survey control center (open/closed toggles, token generator, report configuration modal).
* [`front-end/src/routes/dashboard/+page.svelte`](file:///Users/wiegandp/Desktop/standalone/front-end/src/routes/dashboard/+page.svelte): Main dashboard with categorized list views and intake modals.

---

## 4. Test Suites & Verification Commands

All unit tests are fully hermetic and execute locally without live cloud credentials.

### Backend Functions Test Suite (Node 24 `node:test`)
```bash
cd functions
npm test
npm run lint
```
* **31 tests** covering all guards, security checks, error recoveries, and mock Cloud Run/Storage clients.

### Frontend Test Suite (Vitest)
```bash
cd front-end
npm test        # or npx vitest run
npm run build   # Verifies static SvelteKit production compilation
```
* **15 tests** covering state machine evaluation, clock skew offset calculations, slug transformations, and authentication stores.

### Python Orchestrator Syntax Verification
```bash
python3 -m py_compile orchestrator/survey_analytics_orchestrator.py
```
