/**
 * @fileoverview Survey deep deletion service.
 * Performs safe, atomic, multi-target deletion of survey configurations,
 * participant responses subcollections, and associated Cloud Storage assets.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { ExecutionsClient } = require("@google-cloud/run").v2;
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

/**
 * Callable Function: `deleteSurvey`
 * Executes deep survey deletion:
 * 1. Checks for and terminates any active Cloud Run pipeline execution to prevent orphaned file writes.
 * 2. Deletes all associated Cloud Storage artifacts (reports, checkpoints, uploaded CSVs).
 * 3. Recursively deletes the Firestore survey document and all subcollections (responses, respondents, admin).
 */
exports.deleteSurvey = onCall({ region: "us-central1", timeoutSeconds: 540 }, async (request) => {
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
        const bucket = getStorage().bucket();

        logger.info(`Starting deep deletion for survey: ${slug}`);

        // Concurrency Invariant: Terminate active Cloud Run executions to prevent race conditions during deletion
        try {
            const adminRef = db.collection("surveys").doc(slug).collection("admin").doc("metadata");
            const adminDoc = await adminRef.get();
            if (adminDoc.exists) {
                const data = adminDoc.data();
                const executionName = data.telemetry && data.telemetry.execution_name;
                if (executionName && !data.telemetry.is_complete) {
                    const execClient = new ExecutionsClient();
                    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
                    const fullExecutionName = executionName.startsWith("projects/")
                        ? executionName
                        : `projects/${projectId}/locations/us-central1/jobs/analytics-orchestrator-job/executions/${executionName}`;
                    
                    logger.info(`Survey deletion requested for ${slug}: Cancelling active Cloud Run Job execution ${fullExecutionName}...`);
                    await execClient.cancelExecution({ name: fullExecutionName }).catch(e => {
                        logger.warn(`Warning cancelling execution ${fullExecutionName} during deletion of ${slug}:`, e);
                    });
                }
            }
        } catch (cancelErr) {
            logger.warn(`Warning checking/cancelling active pipeline for ${slug} during deletion:`, cancelErr);
        }

        // Storage Cleanup: Wipe out both generated reports and raw uploaded data directories
        const reportsPrefix = `reports/${slug}/`;
        const uploadsPrefix = `uploads/${slug}/`;

        await Promise.all([
            bucket.deleteFiles({ prefix: reportsPrefix }).catch(e => logger.warn(`Warning deleting reports for ${slug}:`, e)),
            bucket.deleteFiles({ prefix: uploadsPrefix }).catch(e => logger.warn(`Warning deleting uploads for ${slug}:`, e))
        ]);

        // Firestore Cleanup: Recursively delete survey doc and subcollections (responses, respondents, admin)
        const surveyRef = db.collection("surveys").doc(slug);
        await db.recursiveDelete(surveyRef);
        logger.info(`Successfully performed deep deletion for survey: ${slug}`);

        return { success: true, status: "deletion_completed" };
    } catch (e) {
        logger.error(`Failed to trigger survey deletion for ${slug}:`, e);
        throw new HttpsError("internal", `Failed to trigger survey deletion: ${e.message}`);
    }
});
