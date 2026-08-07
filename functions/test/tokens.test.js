const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { initializeApp, getApps } = require("firebase-admin/app");
const adminFirestore = require("firebase-admin/firestore");

if (!getApps().length) {
    initializeApp();
}

describe("tokens.js Callables", () => {
    let originalGetFirestore;
    let mockBulkWriterSets;
    let mockBulkWriterClosed;

    beforeEach(() => {
        mockBulkWriterSets = [];
        mockBulkWriterClosed = false;

        const mockFirestore = {
            collection: () => ({
                doc: (slug) => ({
                    collection: () => ({
                        doc: (tokenId) => ({
                            path: `surveys/${slug}/respondents/${tokenId}`
                        })
                    })
                })
            }),
            bulkWriter: () => ({
                set: (docRef, data) => {
                    mockBulkWriterSets.push({ path: docRef.path, data });
                },
                close: async () => {
                    mockBulkWriterClosed = true;
                }
            })
        };

        originalGetFirestore = adminFirestore.getFirestore;
        adminFirestore.getFirestore = () => mockFirestore;

        delete require.cache[require.resolve("../src/tokens")];
    });

    afterEach(() => {
        adminFirestore.getFirestore = originalGetFirestore;
        delete require.cache[require.resolve("../src/tokens")];
    });

    describe("generateSurveyTokens Callable", () => {
        test("1. Security Guard: Rejects request if caller is not an admin", async () => {
            const { generateSurveyTokens } = require("../src/tokens");
            await assert.rejects(
                async () => generateSurveyTokens.run({
                    auth: null,
                    data: { slug: "survey-1", count: 10 }
                }),
                (err) => err.code === "permission-denied"
            );

            await assert.rejects(
                async () => generateSurveyTokens.run({
                    auth: { token: { admin: false } },
                    data: { slug: "survey-1", count: 10 }
                }),
                (err) => err.code === "permission-denied"
            );
        });

        test("2. Validation Guard: Rejects invalid counts and missing slugs", async () => {
            const { generateSurveyTokens } = require("../src/tokens");
            const invalidPayloads = [
                { slug: "", count: 10 },
                { slug: "survey-1", count: 0 },
                { slug: "survey-1", count: -5 },
                { slug: "survey-1", count: "100" },
                { slug: "survey-1", count: 10001 }
            ];

            for (const payload of invalidPayloads) {
                await assert.rejects(
                    async () => generateSurveyTokens.run({
                        auth: { token: { admin: true } },
                        data: payload
                    }),
                    (err) => err.code === "invalid-argument",
                    `Should reject invalid payload: ${JSON.stringify(payload)}`
                );
            }
        });

        test("3. Happy Path: Batch generates N unique 16-hex tokens and calls BulkWriter", async () => {
            const { generateSurveyTokens } = require("../src/tokens");
            const requestedCount = 25;

            const result = await generateSurveyTokens.run({
                auth: { token: { admin: true, email: "admin@example.com" } },
                data: { slug: "community-feedback", count: requestedCount }
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.tokens.length, requestedCount);

            // Verify all tokens are unique 16-character hexadecimal strings
            const uniqueTokens = new Set(result.tokens);
            assert.strictEqual(uniqueTokens.size, requestedCount);
            for (const token of result.tokens) {
                assert.match(token, /^[0-9a-f]{16}$/);
            }

            // Verify BulkWriter operations
            assert.strictEqual(mockBulkWriterSets.length, requestedCount);
            assert.strictEqual(mockBulkWriterClosed, true);
            assert.strictEqual(mockBulkWriterSets[0].data.createdBy, "admin@example.com");
            assert.ok(mockBulkWriterSets[0].path.startsWith("surveys/community-feedback/respondents/"));
        });
    });
});
