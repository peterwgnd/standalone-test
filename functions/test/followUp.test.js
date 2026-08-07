const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const adminFirestore = require("firebase-admin/firestore");
const { GoogleGenAI } = require("@google/genai");

/**
 * Helper to construct mock Firestore document snapshots for testing.
 */
function createMockSnapshot(data, path, updateFn = async () => {}) {
    const exists = data !== null && data !== undefined && Object.keys(data).length > 0;
    return {
        exists,
        data: () => data || {},
        ref: {
            path,
            update: updateFn
        }
    };
}

describe("generateFollowUp Trigger", () => {
    let originalGetFirestore;
    let originalGenerateContentInternal;
    let mockSurveyDoc;
    let mockAdminDoc;
    let mockRespondentDoc;
    let generatedAiText;

    beforeEach(() => {
        generatedAiText = "Can you describe what specific changes would help Main St.?";
        
        // Default mock document states
        mockSurveyDoc = {
            exists: true,
            data: () => ({ status: "open", requireValidToken: false })
        };
        mockAdminDoc = {
            exists: true,
            data: () => ({ taskPrompt: "Explore transit improvements" })
        };
        mockRespondentDoc = {
            exists: true,
            data: () => ({ createdAt: new Date() })
        };

        const mockFirestore = {
            collection: (colName) => {
                if (colName === "surveys") {
                    return {
                        doc: () => ({
                            get: async () => mockSurveyDoc,
                            collection: (subCol) => {
                                if (subCol === "admin") {
                                    return {
                                        doc: () => ({
                                            get: async () => mockAdminDoc
                                        })
                                    };
                                }
                                if (subCol === "respondents") {
                                    return {
                                        doc: () => ({
                                            get: async () => mockRespondentDoc
                                        })
                                    };
                                }
                                return { doc: () => ({ get: async () => ({ exists: false }) }) };
                            }
                        })
                    };
                }
                return { doc: () => ({ get: async () => ({ exists: false }) }) };
            },
            runTransaction: async (cb) => {
                const transaction = {
                    get: async () => ({
                        data: () => ({ status: "started" })
                    }),
                    update: () => {}
                };
                return await cb(transaction);
            }
        };

        originalGetFirestore = adminFirestore.getFirestore;
        adminFirestore.getFirestore = () => mockFirestore;

        const dummyAi = new GoogleGenAI({ apiKey: "test-key" });
        const modelsProto = Object.getPrototypeOf(dummyAi.models);
        originalGenerateContentInternal = modelsProto.generateContentInternal;
        modelsProto.generateContentInternal = async () => ({ text: generatedAiText });
    });

    afterEach(() => {
        adminFirestore.getFirestore = originalGetFirestore;
        const dummyAi = new GoogleGenAI({ apiKey: "test-key" });
        const modelsProto = Object.getPrototypeOf(dummyAi.models);
        modelsProto.generateContentInternal = originalGenerateContentInternal;
    });

    test("1. Happy Path: Generates follow-up question and updates response doc", async () => {
        const beforeSnap = createMockSnapshot({}, "surveys/transit-survey/responses/user-1");
        
        let updatedPayload = null;
        const afterSnap = createMockSnapshot({
            status: "in_progress",
            answers: {
                0: {
                    question: "What is your main transit concern?",
                    answer: "Main St. is too congested during morning rush hour."
                }
            }
        }, "surveys/transit-survey/responses/user-1", async (payload) => {
            updatedPayload = payload;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.ok(updatedPayload, "Expected document to be updated");
        assert.strictEqual(updatedPayload["answers.0.followUpQuestion"], generatedAiText);
        assert.strictEqual(updatedPayload.status, "pendingFollowUpAnswer_Q0");
    });

    test("2. Idempotency Guard: Aborts if status indicates in-flight generation", async () => {
        const beforeSnap = createMockSnapshot({}, "surveys/transit-survey/responses/user-1");
        
        let wasUpdated = false;
        const afterSnap = createMockSnapshot({
            status: "generatingFollowUp_Q0",
            answers: {
                0: { question: "Q1", answer: "A1" }
            }
        }, "surveys/transit-survey/responses/user-1", async () => {
            wasUpdated = true;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.strictEqual(wasUpdated, false, "Should not update doc if status is already generatingFollowUp_");
    });

    test("3. Unchanged Answers Guard: Aborts if answers have not changed", async () => {
        const answersObj = { 0: { question: "Q1", answer: "A1" } };
        const beforeSnap = createMockSnapshot({ answers: answersObj }, "surveys/transit-survey/responses/user-1");
        
        let wasUpdated = false;
        const afterSnap = createMockSnapshot({
            answers: answersObj,
            lastPing: new Date()
        }, "surveys/transit-survey/responses/user-1", async () => {
            wasUpdated = true;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.strictEqual(wasUpdated, false, "Should not trigger AI generation if answers map is unchanged");
    });

    test("4. Security Guard (DoW): Aborts if answer exceeds 2000 characters", async () => {
        const longAnswer = "x".repeat(2001);
        const beforeSnap = createMockSnapshot({}, "surveys/transit-survey/responses/user-1");
        
        let wasUpdated = false;
        const afterSnap = createMockSnapshot({
            status: "in_progress",
            answers: {
                0: { question: "What is your concern?", answer: longAnswer }
            }
        }, "surveys/transit-survey/responses/user-1", async () => {
            wasUpdated = true;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.strictEqual(wasUpdated, false, "Should reject oversized answer payloads");
    });

    test("5. Access Control Guard: Aborts if survey is closed", async () => {
        mockSurveyDoc = {
            exists: true,
            data: () => ({ status: "closed", requireValidToken: false })
        };

        const beforeSnap = createMockSnapshot({}, "surveys/transit-survey/responses/user-1");
        
        let wasUpdated = false;
        const afterSnap = createMockSnapshot({
            status: "in_progress",
            answers: {
                0: { question: "Q1", answer: "Valid answer" }
            }
        }, "surveys/transit-survey/responses/user-1", async () => {
            wasUpdated = true;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.strictEqual(wasUpdated, false, "Should not generate follow-ups for closed surveys");
    });

    test("6. Error Recovery: Writes error status if Gemini generation fails", async () => {
        const dummyAi = new GoogleGenAI({ apiKey: "test-key" });
        const modelsProto = Object.getPrototypeOf(dummyAi.models);
        modelsProto.generateContentInternal = async () => {
            throw new Error("Internal Gemini Service Unavailable");
        };

        const beforeSnap = createMockSnapshot({}, "surveys/transit-survey/responses/user-1");
        
        let updatedPayload = null;
        const afterSnap = createMockSnapshot({
            status: "in_progress",
            answers: {
                0: { question: "What is your concern?", answer: "Valid answer" }
            }
        }, "surveys/transit-survey/responses/user-1", async (payload) => {
            updatedPayload = payload;
        });

        const { generateFollowUp } = require("../src/followUp");

        await generateFollowUp.run({
            data: { before: beforeSnap, after: afterSnap },
            params: { surveySlug: "transit-survey", id: "user-1" }
        });

        assert.ok(updatedPayload, "Expected error state to be written to doc");
        assert.strictEqual(updatedPayload["answers.0.error"], true);
        assert.strictEqual(updatedPayload.status, "error_Q0");
    });
});
