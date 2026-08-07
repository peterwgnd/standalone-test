/**
 * @fileoverview Cloud Functions entry point for Standalone Sensemaking AI.
 * Initializes the Firebase Admin SDK and exports domain-specific services for
 * survey follow-up generation, analytics pipeline orchestration, deep survey deletion,
 * administrator authentication & IAM, and respondent token management.
 */

const { initializeApp } = require("firebase-admin/app");

// Initialize Firebase Admin SDK once across the function runtime
initializeApp();

// 1. Follow-up generation (Firestore trigger + Gemini)
const { generateFollowUp } = require("./src/followUp");

// 2. Analytics pipeline orchestration (Cloud Run Jobs v2 API)
const { triggerAnalyticsPipeline, cancelAnalyticsPipeline } = require("./src/pipeline");

// 3. Survey deep deletion (Atomic Cloud Storage + Firestore recursive wipe)
const { deleteSurvey } = require("./src/deletion");

// 4. Administrator IAM & custom claims management
const { initAdmin, inviteAdmin, syncAdminClaims } = require("./src/auth");

// 5. Survey participant token generation (BulkWriter)
const { generateSurveyTokens } = require("./src/tokens");

module.exports = {
    generateFollowUp,
    triggerAnalyticsPipeline,
    cancelAnalyticsPipeline,
    deleteSurvey,
    initAdmin,
    inviteAdmin,
    syncAdminClaims,
    generateSurveyTokens,
};
