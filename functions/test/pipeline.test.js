const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { initializeApp, getApps } = require("firebase-admin/app");
const adminFirestore = require("firebase-admin/firestore");
const adminStorage = require("firebase-admin/storage");
const { JobsClient, ExecutionsClient } = require("@google-cloud/run").v2;

if (!getApps().length) {
    initializeApp();
}

describe("pipeline.js Callables", () => {
    let originalGetFirestore;
    let originalGetStorage;
    let originalJobPath;
    let originalRunJob;
    let originalCancelExecution;
    let originalEmulatorEnv;

    let mockMetadataDoc;
    let mockMetadataUpdate;
    let mockDeletedFilesPrefix;
    let mockRunJobPayload;
    let mockCancelExecutionPayload;

    beforeEach(() => {
        originalEmulatorEnv = process.env.FUNCTIONS_EMULATOR;
        delete process.env.FUNCTIONS_EMULATOR;
        process.env.GCLOUD_PROJECT = "test-project";

        mockMetadataDoc = {
            exists: true,
            data: () => ({
                telemetry: {
                    status: "COMPLETED",
                    is_complete: true,
                    execution_name: "test-exec-123"
                }
            })
        };

        mockMetadataUpdate = null;
        mockDeletedFilesPrefix = null;
        mockRunJobPayload = null;
        mockCancelExecutionPayload = null;

        const mockFirestore = {
            collection: () => ({
                doc: () => ({
                    collection: () => ({
                        doc: () => ({
                            get: async () => mockMetadataDoc,
                            set: async (payload) => {
                                mockMetadataUpdate = payload;
                            },
                            update: async (payload) => {
                                mockMetadataUpdate = payload;
                            }
                        })
                    })
                })
            }),
            runTransaction: async (cb) => {
                const transaction = {
                    get: async () => mockMetadataDoc,
                    set: (ref, payload) => {
                        mockMetadataUpdate = payload;
                    }
                };
                return await cb(transaction);
            }
        };

        originalGetFirestore = adminFirestore.getFirestore;
        adminFirestore.getFirestore = () => mockFirestore;

        const mockBucket = {
            deleteFiles: async ({ prefix }) => {
                mockDeletedFilesPrefix = prefix;
            }
        };

        originalGetStorage = adminStorage.getStorage;
        adminStorage.getStorage = () => ({
            bucket: () => mockBucket
        });

        // Mock Cloud Run JobsClient prototypes
        originalJobPath = JobsClient.prototype.jobPath;
        originalRunJob = JobsClient.prototype.runJob;
        JobsClient.prototype.jobPath = function (projectId, location, jobName) {
            return `projects/${projectId}/locations/${location}/jobs/${jobName}`;
        };
        JobsClient.prototype.runJob = async function (req) {
            mockRunJobPayload = req;
            return [{ name: "projects/test-project/locations/us-central1/jobs/analytics-orchestrator-job/executions/exec-abc" }];
        };

        // Mock Cloud Run ExecutionsClient prototypes
        originalCancelExecution = ExecutionsClient.prototype.cancelExecution;
        ExecutionsClient.prototype.cancelExecution = async function (req) {
            mockCancelExecutionPayload = req;
            return [{}];
        };

        delete require.cache[require.resolve("../src/pipeline")];
    });

    afterEach(() => {
        adminFirestore.getFirestore = originalGetFirestore;
        adminStorage.getStorage = originalGetStorage;
        JobsClient.prototype.jobPath = originalJobPath;
        JobsClient.prototype.runJob = originalRunJob;
        ExecutionsClient.prototype.cancelExecution = originalCancelExecution;
        if (originalEmulatorEnv !== undefined) {
            process.env.FUNCTIONS_EMULATOR = originalEmulatorEnv;
        } else {
            delete process.env.FUNCTIONS_EMULATOR;
        }
        delete require.cache[require.resolve("../src/pipeline")];
    });

    describe("triggerAnalyticsPipeline", () => {
        test("1. Security Guard: Rejects request if not authenticated as admin", async () => {
            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            await assert.rejects(
                async () => triggerAnalyticsPipeline.run({
                    auth: null,
                    data: { surveySlug: "valid-survey" }
                }),
                (err) => err.code === "permission-denied"
            );

            await assert.rejects(
                async () => triggerAnalyticsPipeline.run({
                    auth: { token: { admin: false } },
                    data: { surveySlug: "valid-survey" }
                }),
                (err) => err.code === "permission-denied"
            );
        });

        test("2. Validation Guard: Rejects invalid or dangerous slug characters", async () => {
            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            const invalidSlugs = ["", "survey with space", "../traversal", "survey/slug", "survey$bad"];
            for (const badSlug of invalidSlugs) {
                await assert.rejects(
                    async () => triggerAnalyticsPipeline.run({
                        auth: { token: { admin: true } },
                        data: { surveySlug: badSlug }
                    }),
                    (err) => err.code === "invalid-argument",
                    `Should reject invalid slug: ${badSlug}`
                );
            }
        });

        test("3. Concurrency Guard: Blocks overlapping run when job is actively running (<15m)", async () => {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            mockMetadataDoc = {
                exists: true,
                data: () => ({
                    telemetry: {
                        status: "RUNNING_STEP_2",
                        is_complete: false,
                        updated_at: { toDate: () => tenMinutesAgo }
                    }
                })
            };

            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            await assert.rejects(
                async () => triggerAnalyticsPipeline.run({
                    auth: { token: { admin: true } },
                    data: { surveySlug: "active-survey" }
                }),
                (err) => err.code === "already-exists"
            );
        });

        test("4. Zombie Recovery Guard: Allows starting new run if active job is stale (>15m)", async () => {
            const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
            mockMetadataDoc = {
                exists: true,
                data: () => ({
                    telemetry: {
                        status: "RUNNING_STEP_1",
                        is_complete: false,
                        updated_at: { toDate: () => twentyMinutesAgo }
                    }
                })
            };

            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            const result = await triggerAnalyticsPipeline.run({
                auth: { token: { admin: true } },
                data: { surveySlug: "zombie-survey" }
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.operation.includes("exec-abc"));
        });

        test("5. Checkpoint Purge: Deletes Cloud Storage directory when purge_checkpoints is true", async () => {
            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            const result = await triggerAnalyticsPipeline.run({
                auth: { token: { admin: true } },
                data: {
                    surveySlug: "purge-survey",
                    purge_checkpoints: true
                }
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(mockDeletedFilesPrefix, "reports/purge-survey/");
        });

        test("6. Dispatch & Argument Serialization: Translates options to container CLI arguments", async () => {
            const { triggerAnalyticsPipeline } = require("../src/pipeline");
            const result = await triggerAnalyticsPipeline.run({
                auth: { token: { admin: true } },
                data: {
                    surveySlug: "transit-2026",
                    model_name: "gemini-3.5-flash",
                    additional_context: "Focus on subway delays",
                    topics: "Delays,Cleanliness,Safety",
                    skip_autoraters: true,
                    skip_quote_extraction: true
                }
            });

            assert.strictEqual(result.success, true);
            assert.ok(mockRunJobPayload, "Expected runJob payload to be defined");
            
            const passedArgs = mockRunJobPayload.overrides.containerOverrides[0].args;
            assert.deepStrictEqual(passedArgs, [
                "-s", "transit-2026",
                "-o", "/tmp/transit-2026",
                "--model_name", "gemini-3.5-flash",
                "--additional_context", "Focus on subway delays",
                "--topics", "Delays,Cleanliness,Safety",
                "--skip_autoraters",
                "--skip_quote_extraction"
            ]);
        });
    });

    describe("cancelAnalyticsPipeline", () => {
        test("7. Security Guard: Rejects cancellation if not admin", async () => {
            const { cancelAnalyticsPipeline } = require("../src/pipeline");
            await assert.rejects(
                async () => cancelAnalyticsPipeline.run({
                    auth: { token: { admin: false } },
                    data: { surveySlug: "active-survey" }
                }),
                (err) => err.code === "permission-denied"
            );
        });

        test("8. Precondition Guard: Fails if no execution is recorded in metadata", async () => {
            mockMetadataDoc = {
                exists: true,
                data: () => ({ telemetry: {} })
            };

            const { cancelAnalyticsPipeline } = require("../src/pipeline");
            await assert.rejects(
                async () => cancelAnalyticsPipeline.run({
                    auth: { token: { admin: true } },
                    data: { surveySlug: "no-exec-survey" }
                }),
                (err) => err.code === "failed-precondition"
            );
        });

        test("9. Successful Cancellation: Invokes Cloud Run cancelExecution and updates status", async () => {
            mockMetadataDoc = {
                exists: true,
                data: () => ({
                    telemetry: {
                        execution_name: "analytics-orchestrator-job-r7k9x",
                        is_complete: false
                    }
                })
            };

            const { cancelAnalyticsPipeline } = require("../src/pipeline");
            const result = await cancelAnalyticsPipeline.run({
                auth: { token: { admin: true } },
                data: { surveySlug: "active-survey" }
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(
                mockCancelExecutionPayload.name,
                "projects/test-project/locations/us-central1/jobs/analytics-orchestrator-job/executions/analytics-orchestrator-job-r7k9x"
            );
            assert.strictEqual(mockMetadataUpdate["telemetry.status"], "Canceled by user.");
            assert.strictEqual(mockMetadataUpdate["telemetry.is_complete"], false);
        });
    });
});
