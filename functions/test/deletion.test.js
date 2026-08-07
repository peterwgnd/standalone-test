const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { initializeApp, getApps } = require("firebase-admin/app");
const adminFirestore = require("firebase-admin/firestore");
const adminStorage = require("firebase-admin/storage");
const { ExecutionsClient } = require("@google-cloud/run").v2;

if (!getApps().length) {
    initializeApp({ storageBucket: "test-bucket.appspot.com" });
}

describe("deleteSurvey Callable", () => {
    let originalGetFirestore;
    let originalGetStorage;
    let originalCancelExecution;

    let mockMetadataDoc;
    let mockDeletedStoragePrefixes;
    let mockRecursiveDeletedDoc;
    let mockCanceledExecutionName;

    beforeEach(() => {
        process.env.GCLOUD_PROJECT = "test-project";
        mockDeletedStoragePrefixes = [];
        mockRecursiveDeletedDoc = null;
        mockCanceledExecutionName = null;

        mockMetadataDoc = {
            exists: true,
            data: () => ({
                telemetry: {
                    execution_name: "analytics-job-active-123",
                    is_complete: false
                }
            })
        };

        const mockFirestore = {
            collection: () => ({
                doc: (slug) => ({
                    path: `surveys/${slug}`,
                    collection: () => ({
                        doc: () => ({
                            get: async () => mockMetadataDoc
                        })
                    })
                })
            }),
            recursiveDelete: async (docRef) => {
                mockRecursiveDeletedDoc = docRef;
            }
        };

        originalGetFirestore = adminFirestore.getFirestore;
        adminFirestore.getFirestore = () => mockFirestore;

        const mockBucket = {
            deleteFiles: async ({ prefix }) => {
                mockDeletedStoragePrefixes.push(prefix);
            }
        };

        originalGetStorage = adminStorage.getStorage;
        adminStorage.getStorage = () => ({
            bucket: () => mockBucket
        });

        originalCancelExecution = ExecutionsClient.prototype.cancelExecution;
        ExecutionsClient.prototype.cancelExecution = async function ({ name }) {
            mockCanceledExecutionName = name;
            return [{}];
        };

        delete require.cache[require.resolve("../src/deletion")];
    });

    afterEach(() => {
        adminFirestore.getFirestore = originalGetFirestore;
        adminStorage.getStorage = originalGetStorage;
        ExecutionsClient.prototype.cancelExecution = originalCancelExecution;
        delete require.cache[require.resolve("../src/deletion")];
    });

    test("1. Security Guard: Rejects request if caller is not an admin", async () => {
        const { deleteSurvey } = require("../src/deletion");
        await assert.rejects(
            async () => deleteSurvey.run({
                auth: null,
                data: { surveySlug: "old-survey" }
            }),
            (err) => err.code === "permission-denied"
        );

        await assert.rejects(
            async () => deleteSurvey.run({
                auth: { token: { admin: false } },
                data: { surveySlug: "old-survey" }
            }),
            (err) => err.code === "permission-denied"
        );
    });

    test("2. Validation Guard: Rejects invalid or dangerous slug characters", async () => {
        const { deleteSurvey } = require("../src/deletion");
        const invalidSlugs = ["", "invalid survey", "../escape", "survey/nested", "bad*chars"];
        for (const badSlug of invalidSlugs) {
            await assert.rejects(
                async () => deleteSurvey.run({
                    auth: { token: { admin: true } },
                    data: { surveySlug: badSlug }
                }),
                (err) => err.code === "invalid-argument",
                `Should reject invalid slug: ${badSlug}`
            );
        }
    });

    test("3. Concurrency Protection: Cancels running Cloud Run execution prior to deletion", async () => {
        const { deleteSurvey } = require("../src/deletion");
        const result = await deleteSurvey.run({
            auth: { token: { admin: true } },
            data: { surveySlug: "active-survey" }
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(
            mockCanceledExecutionName,
            "projects/test-project/locations/us-central1/jobs/analytics-orchestrator-job/executions/analytics-job-active-123"
        );
    });

    test("4. Storage Purge: Deletes both report and upload storage prefixes", async () => {
        const { deleteSurvey } = require("../src/deletion");
        const result = await deleteSurvey.run({
            auth: { token: { admin: true } },
            data: { surveySlug: "transit-survey" }
        });

        assert.strictEqual(result.success, true);
        assert.ok(mockDeletedStoragePrefixes.includes("reports/transit-survey/"));
        assert.ok(mockDeletedStoragePrefixes.includes("uploads/transit-survey/"));
    });

    test("5. Firestore Cleanup: Calls recursiveDelete on the survey document", async () => {
        const { deleteSurvey } = require("../src/deletion");
        const result = await deleteSurvey.run({
            auth: { token: { admin: true } },
            data: { surveySlug: "housing-2026" }
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.status, "deletion_completed");
        assert.ok(mockRecursiveDeletedDoc);
        assert.strictEqual(mockRecursiveDeletedDoc.path, "surveys/housing-2026");
    });
});
