/**
 * @fileoverview Survey respondent token management service.
 * Generates cryptographically secure single-use respondent access tokens
 * and batch-inserts them into survey subcollections using Firestore BulkWriter.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

/**
 * Callable Function: `generateSurveyTokens`
 * Batch creates unique single-use respondent access tokens for an invite-only survey.
 * Writes tokens directly to `surveys/{slug}/respondents/{token}` using BulkWriter for high throughput.
 */
exports.generateSurveyTokens = onCall({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
    // Security Invariant: Require authenticated user with admin custom claim
    if (!request.auth || !request.auth.token.admin) {
        throw new HttpsError("permission-denied", "Only admins can generate tokens.");
    }

    const { slug, count } = request.data;
    if (!slug || !count || typeof count !== "number" || count < 1 || count > 10000) {
        throw new HttpsError("invalid-argument", "Valid slug and count (1-10000) are required.");
    }

    const db = getFirestore("standalone");
    
    try {
        const tokens = [];
        const bulkWriter = db.bulkWriter();
        
        for (let i = 0; i < count; i++) {
            const token = crypto.randomBytes(8).toString("hex");
            tokens.push(token);
            const docRef = db.collection("surveys").doc(slug).collection("respondents").doc(token);
            bulkWriter.set(docRef, {
                createdAt: new Date(),
                createdBy: request.auth.token.email
            });
        }
        
        await bulkWriter.close();
        logger.info(`Successfully generated and wrote ${count} tokens for survey: ${slug}`);
        
        return { success: true, tokens: tokens };
    } catch (e) {
        logger.error(`Error generating tokens for survey ${slug}:`, e);
        throw new HttpsError("internal", `Failed to generate tokens: ${e.message}`);
    }
});
