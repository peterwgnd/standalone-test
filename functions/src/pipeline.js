/**
 * @fileoverview Analytics orchestration pipeline controller functions.
 * Handles triggering, monitoring, and canceling Google Cloud Run Jobs that execute
 * the heavy Python Gemini categorization and report generation pipeline.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { JobsClient, ExecutionsClient } = require("@google-cloud/run").v2;
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

/**
 * Callable Function: `triggerAnalyticsPipeline`
 * Validates admin permissions, initializes telemetry state, purges old checkpoints if requested,
 * and executes the Google Cloud Run analytics job with container CLI argument overrides.
 */
exports.triggerAnalyticsPipeline = onCall({ region: "us-central1" }, async (request) => {
    // Security Invariant: Require authenticated user with admin custom claim
    if (!request.auth || !request.auth.token.admin) {
        throw new HttpsError("permission-denied", "You must be an admin to perform this action.");
    }

    const slug = request.data.surveySlug;
    if (!slug || typeof slug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(slug)) {
        throw new HttpsError("invalid-argument", "Invalid slug format.");
    }

    // Guard: Prevent production Cloud Run triggers from local emulator
    if (process.env.FUNCTIONS_EMULATOR === "true") {
        logger.warn(`Attempted to trigger Cloud Run pipeline for ${slug} from local emulator.`);
        throw new HttpsError(
            "failed-precondition",
            "Cannot trigger production Cloud Run jobs while using the local Firebase emulator. Please test against the production database, or run the Python script locally."
        );
    }

    try {
        const db = getFirestore("standalone");
        const adminRef = db.collection("surveys").doc(slug).collection("admin").doc("metadata");

        // Concurrency & Zombie Invariant: Verify if a job is already running before allowing a new execution
        await db.runTransaction(async (transaction) => {
            const adminDoc = await transaction.get(adminRef);
            if (adminDoc.exists) {
                const data = adminDoc.data();
                const telemetry = data.telemetry;
                if (telemetry && !telemetry.is_complete) {
                    const statusText = (telemetry.status || "").toLowerCase();
                    const isFailed = statusText.includes("fail") || statusText.includes("error") || statusText.includes("cancel");
                    
                    // Zombie Detection: If a Cloud Run job dies abruptly (e.g. OOM or hard timeout),
                    // it cannot write a failure status. Treat jobs inactive for >15 minutes as dead.
                    let isZombie = false;
                    if (telemetry.updated_at) {
                        const updatedTime = telemetry.updated_at.toDate ? telemetry.updated_at.toDate() : new Date(telemetry.updated_at);
                        const diffMinutes = (Date.now() - updatedTime.getTime()) / (1000 * 60);
                        if (diffMinutes > 15) {
                            isZombie = true;
                        }
                    }
                    if (!isFailed && !isZombie) {
                        throw new HttpsError(
                            "already-exists",
                            "An analytics pipeline job is already running for this survey. Please wait for it to complete or cancel it before starting a new one."
                        );
                    }
                }
            }

            const updatePayload = {
                telemetry: {
                    status: "INITIALIZING",
                    is_complete: false,
                    updated_at: FieldValue.serverTimestamp()
                }
            };
            if (request.data.purge_checkpoints) {
                updatePayload.report_url = FieldValue.delete();
                updatePayload.intermediate_files = FieldValue.delete();
            }
            transaction.set(adminRef, updatePayload, { merge: true });
        });

        // Checkpoint Purge: Hard delete storage artifacts when starting a clean regeneration run
        if (request.data.purge_checkpoints) {
            const bucket = getStorage().bucket();
            const prefix = `reports/${slug}/`;
            logger.info(`Purge requested for ${slug}. Deleting all files under ${prefix}`);
            await bucket.deleteFiles({ prefix: prefix });
        }

        const runClient = new JobsClient();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
        const name = runClient.jobPath(projectId, "us-central1", "analytics-orchestrator-job");

        // Construct container CLI overrides: isolate output directory to prevent cross-run checkpoint bleeding
        const runArgs = ["-s", slug, "-o", `/tmp/${slug}`];
        if (request.data.model_name) {
            runArgs.push("--model_name", request.data.model_name);
        }
        if (request.data.additional_context) {
            runArgs.push("--additional_context", request.data.additional_context);
        }
        if (request.data.topics) {
            runArgs.push("--topics", request.data.topics);
        }
        if (request.data.skip_autoraters) {
            runArgs.push("--skip_autoraters");
        }
        if (request.data.skip_quote_extraction) {
            runArgs.push("--skip_quote_extraction");
        }

        const req = {
            name: name,
            overrides: {
                containerOverrides: [
                    {
                        args: runArgs
                    }
                ]
            }
        };

        const [operation] = await runClient.runJob(req);
        logger.info(`Successfully triggered Cloud Run Job for slug ${slug}: ${operation.name}`);

        return { success: true, operation: operation.name };
    } catch (e) {
        logger.error(`Failed to trigger Cloud Run Job for ${slug}:`, e);
        if (e instanceof HttpsError) {
            throw e;
        }
        try {
            const db = getFirestore("standalone");
            const adminRef = db.collection("surveys").doc(slug).collection("admin").doc("metadata");
            await adminRef.set({
                telemetry: {
                    status: "FAILED_TO_START",
                    is_complete: false,
                    updated_at: FieldValue.serverTimestamp()
                }
            }, { merge: true });
        } catch (resetErr) {
            logger.error(`Failed to reset telemetry status for ${slug}:`, resetErr);
        }
        throw new HttpsError("internal", `Failed to trigger analysis job: ${e.message}`);
    }
});

/**
 * Callable Function: `cancelAnalyticsPipeline`
 * Uses the Cloud Run Executions API to forcefully terminate an in-flight job execution
 * and updates Firestore telemetry to mark the job as canceled.
 */
exports.cancelAnalyticsPipeline = onCall({ region: "us-central1" }, async (request) => {
    // Security Invariant: Require authenticated user with admin custom claim
    if (!request.auth || !request.auth.token.admin) {
        throw new HttpsError("permission-denied", "You must be an admin to perform this action.");
    }

    const slug = request.data.surveySlug;
    if (!slug || typeof slug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(slug)) {
        throw new HttpsError("invalid-argument", "Invalid slug format.");
    }

    try {
        const db = getFirestore("standalone");
        const adminRef = db.collection("surveys").doc(slug).collection("admin").doc("metadata");
        const adminDoc = await adminRef.get();
        if (!adminDoc.exists) {
            throw new HttpsError("not-found", "Survey metadata not found");
        }
        const data = adminDoc.data();
        const executionName = data.telemetry && data.telemetry.execution_name;
        if (!executionName) {
            throw new HttpsError("failed-precondition", "No active execution found for this survey.");
        }

        const execClient = new ExecutionsClient();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
        const fullExecutionName = executionName.startsWith("projects/")
            ? executionName
            : `projects/${projectId}/locations/us-central1/jobs/analytics-orchestrator-job/executions/${executionName}`;

        await execClient.cancelExecution({ name: fullExecutionName });
        logger.info(`Successfully cancelled Cloud Run Job execution for slug ${slug}: ${fullExecutionName}`);

        // Update telemetry state to reflect user cancellation
        await adminRef.update({
            "telemetry.status": "Canceled by user.",
            "telemetry.is_complete": false,
            "telemetry.updated_at": FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (e) {
        logger.error(`Failed to cancel Cloud Run Job for ${slug}:`, e);
        if (e instanceof HttpsError) {
            throw e;
        }
        throw new HttpsError("internal", `Failed to cancel analysis job: ${e.message}`);
    }
});
