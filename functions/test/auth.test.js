const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { initializeApp, getApps } = require("firebase-admin/app");
const adminFirestore = require("firebase-admin/firestore");
const adminAuth = require("firebase-admin/auth");

if (!getApps().length) {
    initializeApp();
}

describe("auth.js IAM Services", () => {
    let originalGetFirestore;
    let originalGetAuth;
    let originalAdminEmail;

    let mockAdminUserDocs;
    let mockCustomClaims;
    let mockCreatedUsers;

    beforeEach(() => {
        originalAdminEmail = process.env.ADMIN_EMAIL;
        process.env.ADMIN_EMAIL = "superadmin@example.com";

        mockAdminUserDocs = new Map();
        mockCustomClaims = new Map();
        mockCreatedUsers = new Map();

        const mockFirestore = {
            collection: (colName) => {
                if (colName === "admin_users") {
                    return {
                        doc: (uid) => ({
                            set: async (data) => {
                                mockAdminUserDocs.set(uid, data);
                            },
                            get: async () => ({
                                exists: mockAdminUserDocs.has(uid),
                                data: () => mockAdminUserDocs.get(uid)
                            })
                        })
                    };
                }
                return { doc: () => ({ set: async () => {}, get: async () => ({ exists: false }) }) };
            }
        };

        originalGetFirestore = adminFirestore.getFirestore;
        adminFirestore.getFirestore = () => mockFirestore;

        const mockAuth = {
            getUserByEmail: async (email) => {
                if (email === "existing@example.com") {
                    return { uid: "existing-uid-123", email };
                }
                if (mockCreatedUsers.has(email)) {
                    return { uid: mockCreatedUsers.get(email), email };
                }
                const err = new Error("User not found");
                err.code = "auth/user-not-found";
                throw err;
            },
            createUser: async ({ email }) => {
                const newUid = `new-uid-${Date.now()}`;
                mockCreatedUsers.set(email, newUid);
                return { uid: newUid, email };
            },
            setCustomUserClaims: async (uid, claims) => {
                mockCustomClaims.set(uid, claims);
            }
        };

        originalGetAuth = adminAuth.getAuth;
        adminAuth.getAuth = () => mockAuth;

        delete require.cache[require.resolve("../src/auth")];
    });

    afterEach(() => {
        adminFirestore.getFirestore = originalGetFirestore;
        adminAuth.getAuth = originalGetAuth;
        if (originalAdminEmail !== undefined) {
            process.env.ADMIN_EMAIL = originalAdminEmail;
        } else {
            delete process.env.ADMIN_EMAIL;
        }
        delete require.cache[require.resolve("../src/auth")];
    });

    describe("initAdmin Callable", () => {
        test("1. Unauthenticated Guard: Rejects request if not logged in", async () => {
            const { initAdmin } = require("../src/auth");
            await assert.rejects(
                async () => initAdmin.run({ auth: null }),
                (err) => err.code === "unauthenticated"
            );
        });

        test("2. Seed Validation: Rejects user whose email does not match ADMIN_EMAIL", async () => {
            const { initAdmin } = require("../src/auth");
            await assert.rejects(
                async () => initAdmin.run({
                    auth: { uid: "user-999", token: { email: "stranger@example.com" } }
                }),
                (err) => err.code === "permission-denied"
            );
        });

        test("3. Happy Path: Bootstraps admin record when email matches ADMIN_EMAIL", async () => {
            const { initAdmin } = require("../src/auth");
            const result = await initAdmin.run({
                auth: { uid: "admin-uid-1", token: { email: "superadmin@example.com" } }
            });

            assert.strictEqual(result.success, true);
            assert.ok(mockAdminUserDocs.has("admin-uid-1"));
            assert.strictEqual(mockAdminUserDocs.get("admin-uid-1").email, "superadmin@example.com");
        });
    });

    describe("inviteAdmin Callable", () => {
        test("4. Security Guard: Rejects invite request if caller is not admin", async () => {
            const { inviteAdmin } = require("../src/auth");
            await assert.rejects(
                async () => inviteAdmin.run({
                    auth: { uid: "regular-user", token: { admin: false } },
                    data: { email: "colleague@example.com" }
                }),
                (err) => err.code === "permission-denied"
            );
        });

        test("5. Existing User Invite: Provisions admin_users doc for existing user", async () => {
            const { inviteAdmin } = require("../src/auth");
            const result = await inviteAdmin.run({
                auth: { uid: "admin-1", token: { admin: true, email: "superadmin@example.com" } },
                data: { email: "existing@example.com" }
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.uid, "existing-uid-123");
            assert.ok(mockAdminUserDocs.has("existing-uid-123"));
            assert.strictEqual(mockAdminUserDocs.get("existing-uid-123").invitedBy, "superadmin@example.com");
        });

        test("6. New User Invite: Creates Auth account and provisions admin_users doc", async () => {
            const { inviteAdmin } = require("../src/auth");
            const result = await inviteAdmin.run({
                auth: { uid: "admin-1", token: { admin: true, email: "superadmin@example.com" } },
                data: { email: "newcolleague@example.com" }
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.uid);
            assert.ok(mockAdminUserDocs.has(result.uid));
            assert.strictEqual(mockAdminUserDocs.get(result.uid).email, "newcolleague@example.com");
        });
    });

    describe("syncAdminClaims Trigger", () => {
        test("7. Document Written: Grants custom claim { admin: true } on document creation/update", async () => {
            const { syncAdminClaims } = require("../src/auth");
            const event = {
                params: { uid: "target-user-uid" },
                data: {
                    after: {
                        exists: true,
                        data: () => ({ email: "newadmin@example.com" })
                    }
                }
            };

            await syncAdminClaims.run(event);

            assert.deepStrictEqual(mockCustomClaims.get("target-user-uid"), { admin: true });
        });

        test("8. Document Deleted: Revokes custom claim { admin: null } on document deletion", async () => {
            const { syncAdminClaims } = require("../src/auth");
            const event = {
                params: { uid: "revoked-user-uid" },
                data: {
                    after: {
                        exists: false
                    }
                }
            };

            await syncAdminClaims.run(event);

            assert.deepStrictEqual(mockCustomClaims.get("revoked-user-uid"), { admin: null });
        });
    });
});
