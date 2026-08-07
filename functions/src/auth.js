/**
 * @fileoverview Administrator Identity & Access Management (IAM) service.
 * Manages bootstrap admin initialization, admin invitation workflows,
 * and automated custom claim synchronization (admin: true) via Firestore triggers.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

/**
 * Callable Function: `initAdmin`
 * Bootstrap endpoint for instance owners. Compares the authenticated user's email against
 * the configured ADMIN_EMAIL environment seed and adds the initial admin document to Firestore.
 */
exports.initAdmin = onCall({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && request.auth.token.email === adminEmail) {
        logger.info(`Bootstrapping admin record for designated seed admin: ${request.auth.token.email}`);
        
        const db = getFirestore("standalone");
        await db.collection("admin_users").doc(request.auth.uid).set({
            email: request.auth.token.email,
            createdAt: new Date()
        });
        
        // The syncAdminClaims Firestore trigger will automatically detect this document
        // creation and attach the { admin: true } custom claim to the user's Auth token.
        return { success: true };
    }
    
    throw new HttpsError("permission-denied", "You are not the designated administrator.");
});

/**
 * Callable Function: `inviteAdmin`
 * Allows an existing admin to invite new administrators by email.
 * Creates the user record if not present, and provisions their `admin_users` Firestore document.
 */
exports.inviteAdmin = onCall({ region: "us-central1" }, async (request) => {
    // Security Invariant: Only authenticated users with admin claims can invite others
    if (!request.auth || !request.auth.token.admin) {
        throw new HttpsError("permission-denied", "Only admins can invite other admins.");
    }

    const email = request.data.email;
    if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "Valid email address is required.");
    }

    try {
        let userRecord;
        try {
            userRecord = await getAuth().getUserByEmail(email);
        } catch (error) {
            if (error.code === "auth/user-not-found") {
                userRecord = await getAuth().createUser({ email: email });
            } else {
                throw error;
            }
        }
        
        const db = getFirestore("standalone");
        await db.collection("admin_users").doc(userRecord.uid).set({
            email: email,
            invitedBy: request.auth.token.email,
            createdAt: new Date()
        });
        
        return { success: true, uid: userRecord.uid };
    } catch (e) {
        logger.error("Error inviting admin:", e);
        throw new HttpsError("internal", `Failed to invite admin: ${e.message}`);
    }
});

/**
 * Firestore Document Trigger: `admin_users/{uid}`
 * Listens for writes to the admin users collection and synchronizes the { admin: true }
 * Firebase Auth custom claim. Automatically revokes the claim when a document is deleted.
 */
exports.syncAdminClaims = onDocumentWritten({
    document: "admin_users/{uid}",
    database: "standalone"
}, async (event) => {
    const uid = event.params.uid;
    
    // Revocation Invariant: When an admin record is deleted, remove their admin claim immediately
    if (!event.data.after || !event.data.after.exists) {
        logger.info(`Revoking admin claim for UID: ${uid}`);
        await getAuth().setCustomUserClaims(uid, { admin: null });
    } else {
        logger.info(`Granting admin claim for UID: ${uid}`);
        await getAuth().setCustomUserClaims(uid, { admin: true });
    }
});
