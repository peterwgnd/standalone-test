<script>
    import { onMount } from 'svelte';
    import { collection, query, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
    import { db, auth, functions } from '$lib/firebase/firebase-config';
    import { httpsCallable } from 'firebase/functions';
    import { authStore } from '$lib/stores/authStore';
    import { goto } from '$app/navigation';
    import Card from '$lib/components/Card.svelte';
    import Button from '$lib/components/Button.svelte';
    import Input from '$lib/components/Input.svelte';
    import Modal from '$lib/components/Modal.svelte';

    /** @type {any[]} */
    let admins = $state([]);
    let showInviteModal = $state(false);
    let inviteEmail = $state('');
    let isInviting = $state(false);
    let inviteError = $state(null);

    $effect(() => {
        // Simple route guard
        if ($authStore.isAdmin === false) {
            goto('/login');
        }
    });

    onMount(() => {
        if (!$authStore.isAdmin) return;
        
        const q = query(collection(db, 'admin_users'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            /** @type {any[]} */
            let loadedAdmins = [];
            snapshot.forEach((doc) => {
                loadedAdmins.push({ id: doc.id, ...doc.data() });
            });
            admins = loadedAdmins;
        });

        return () => unsubscribe();
    });

    const handleInvite = async () => {
        if (!inviteEmail) return;
        isInviting = true;
        inviteError = null;

        try {
            const inviteAdmin = httpsCallable(functions, 'inviteAdmin');
            await inviteAdmin({ email: inviteEmail });
            showInviteModal = false;
            inviteEmail = '';
        } catch (e) {
            inviteError = e.message;
        } finally {
            isInviting = false;
        }
    };

    /**
     * @param {string} uid
     * @param {string} email
     */
    const revokeAdmin = async (uid, email) => {
        if (!confirm(`Are you sure you want to revoke admin access for ${email}?`)) return;
        try {
            // Deleting the document will trigger syncAdminClaims to revoke the custom claim
            await deleteDoc(doc(db, 'admin_users', uid));
        } catch (e) {
            alert("Failed to revoke admin: " + e.message);
        }
    };
</script>

<svelte:head>
    <title>Manage Admins | Sensemaking</title>
</svelte:head>

<div class="dashboard-container">
    <div class="dashboard-header">
        <div>
            <h1>Manage Administrators</h1>
            <a href="/dashboard" class="back-link">&larr; Back to Dashboard</a>
        </div>
        <Button variant="primary" onClick={() => showInviteModal = true}>Invite Admin</Button>
    </div>

    <Card>
        <div class="table-container">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Invited By</th>
                        <th>Created At</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {#each admins as admin}
                        <tr>
                            <td>{admin.email}</td>
                            <td>{admin.invitedBy || 'System/Seed'}</td>
                            <td>{admin.createdAt?.toDate ? admin.createdAt.toDate().toLocaleString() : 'N/A'}</td>
                            <td class="text-right">
                                {#if auth.currentUser?.uid !== admin.id}
                                    <Button variant="danger" onClick={() => revokeAdmin(admin.id, admin.email)}>Revoke</Button>
                                {:else}
                                    <span class="badge">You</span>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                    {#if admins.length === 0}
                        <tr>
                            <td colspan="4" class="empty-table-state">No admins found.</td>
                        </tr>
                    {/if}
                </tbody>
            </table>
        </div>
    </Card>
</div>

<Modal bind:show={showInviteModal} title="Invite New Admin">
    <form onsubmit={(e) => { e.preventDefault(); handleInvite(); }}>
        <p class="modal-description">
            Inviting a user will grant them full access to all surveys and platform billing. 
        </p>
        
        <div class="form-group">
            <label for="email" class="form-label">Email Address</label>
            <Input id="email" type="email" placeholder="colleague@example.com" bind:value={inviteEmail} required disabled={isInviting} />
            {#if inviteError}
                <div class="error-text">{inviteError}</div>
            {/if}
        </div>

        <div class="modal-actions">
            <Button variant="secondary" onClick={() => showInviteModal = false} disabled={isInviting}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={isInviting || !inviteEmail}>
                {isInviting ? 'Inviting...' : 'Send Invite'}
            </Button>
        </div>
    </form>
</Modal>

<style>
    .dashboard-container {
        max-width: 1000px;
        margin: 0 auto;
        padding: 2rem 1rem;
    }
    .dashboard-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 2rem;
    }
    .dashboard-header h1 {
        margin: 0 0 0.5rem 0;
        font-size: 2rem;
    }
    .back-link {
        color: var(--text-secondary);
        text-decoration: none;
        font-size: 0.875rem;
    }
    .back-link:hover {
        color: var(--primary-color);
    }
    .table-container {
        overflow-x: auto;
    }
    .admin-table {
        width: 100%;
        border-collapse: collapse;
    }
    .admin-table th {
        text-align: left;
        padding: 1rem;
        border-bottom: 1px solid var(--border-color);
        color: var(--text-secondary);
        font-weight: 600;
        font-size: 0.875rem;
    }
    .admin-table td {
        padding: 1rem;
        border-bottom: 1px solid var(--border-color);
        color: var(--text-primary);
        font-size: 0.95rem;
    }
    .admin-table tr:last-child td {
        border-bottom: none;
    }
    .text-right {
        text-align: right !important;
    }
    .empty-table-state {
        text-align: center;
        padding: 2rem;
        color: var(--text-tertiary);
    }
    .badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
    }
    .modal-description {
        margin-bottom: 1.5rem;
        color: var(--text-secondary);
    }
    .form-group {
        margin-bottom: 1.5rem;
    }
    .form-label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
    }
    .error-text {
        color: var(--danger-color);
        margin-top: 0.5rem;
        font-size: 0.875rem;
    }
    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
    }
</style>
