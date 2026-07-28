<script>
    import { onMount } from 'svelte';
    import { surveyStore } from '$lib/stores/surveyStore';
    import { authStore } from '$lib/stores/authStore';
    import Button from '$lib/components/Button.svelte';
    import Card from '$lib/components/Card.svelte';
    import CreateInteractiveModal from './CreateInteractiveModal.svelte';
    import UploadDataModal from './UploadDataModal.svelte';
    import ReportConfigModal from '$lib/components/ReportConfigModal.svelte';
    import ReportLink from '$lib/components/ReportLink.svelte';

    let showInteractiveModal = $state(false);
    let showUploadModal = $state(false);
    let showReportModal = $state(false);
    let activeReportSlug = $state(null);
    let activeReportPurge = $state(false);

    let serverTimeOffset = $state(0);

    // Initialize the real-time listener when the dashboard mounts
    onMount(() => {
        const unsubscribe = surveyStore.init();
        
        // Fetch server time to calculate client-side clock skew
        fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
            .then(res => {
                const dateHeader = res.headers.get('Date');
                if (dateHeader) {
                    serverTimeOffset = new Date(dateHeader).getTime() - Date.now();
                }
            })
            .catch(err => console.error("Failed to sync server time", err));

        return () => {
            if (unsubscribe) unsubscribe();
        };
    });

    // Derived states
    let openSurveys = $derived($surveyStore.openSurveys || []);
    let closedSurveys = $derived($surveyStore.closedSurveys || []);
    let uploadedSurveys = $derived($surveyStore.uploadedSurveys || []);
    
    let noSurveys = $derived(openSurveys.length === 0 && closedSurveys.length === 0 && uploadedSurveys.length === 0);

    let deletingSurveys = $state(new Set());

    const handleDelete = async (slug) => {
        if (confirm(`Are you sure you want to permanently delete /${slug}? This will erase all participant data, generated reports, and uploaded files. This cannot be undone.`)) {
            try {
                deletingSurveys.add(slug);
                deletingSurveys = new Set(deletingSurveys);
                
                await surveyStore.deleteSurvey(slug);
            } catch (err) {
                alert("Failed to delete survey: " + err.message);
            } finally {
                deletingSurveys.delete(slug);
                deletingSurveys = new Set(deletingSurveys);
            }
        }
    };

    const openReportModal = (slug, purge) => {
        activeReportSlug = slug;
        activeReportPurge = purge;
        showReportModal = true;
    };

    const evaluatePipelineState = (telemetry) => {
        if (!telemetry) return 'NOT_STARTED';
        if (telemetry.is_complete) return 'COMPLETED';
        
        const statusText = (telemetry.status || '').toLowerCase();
        if (statusText.includes('fail') || statusText.includes('error') || statusText.includes('cancel')) {
            return 'FAILED';
        }

        if (telemetry.updated_at) {
            const updatedTime = telemetry.updated_at.toDate ? telemetry.updated_at.toDate() : new Date(telemetry.updated_at);
            const now = new Date(Date.now() + serverTimeOffset);
            const diffMinutes = (now - updatedTime) / (1000 * 60);
            if (diffMinutes > 15) {
                return 'FAILED_ZOMBIE';
            }
        }

        return 'RUNNING';
    };
    
</script>

<svelte:head>
    <title>Dashboard | Sensemaking</title>
</svelte:head>

<div class="dashboard-container">
    <div class="dashboard-header">
        <div>
            <h1>Sensemaking Dashboard</h1>
            <p class="subtitle">Welcome back, {$authStore.user?.email || 'Admin'}</p>
        </div>
        <div class="action-buttons">
            <Button variant="secondary" href="/dashboard/users">Manage Admins</Button>
            <Button variant="secondary" onClick={() => showUploadModal = true}>Upload Data</Button>
            <Button variant="primary" onClick={() => showInteractiveModal = true}>Create New Survey</Button>
        </div>
    </div>

    {#if $surveyStore.loading}
        <div class="loading-state">Loading workspaces...</div>
    {:else if $surveyStore.error}
        <div class="error-state">Error: {$surveyStore.error}</div>
    {:else if noSurveys}
        <div class="empty-state">
            <h3>No Active Projects Detected</h3>
            <p>Click the "Create New Survey" button to initialize a new conversation workspace.</p>
            <Button variant="primary" onClick={() => showInteractiveModal = true}>Initialize Workspace</Button>
        </div>
    {:else}
        <!-- Open Interactive Surveys -->
        {#if openSurveys.length > 0}
            <section class="dashboard-section">
                <div class="section-header">
                    <h2>Open Interactive Surveys</h2>
                    <a href="/dashboard/surveys/open" class="view-all-link">View All</a>
                </div>
                <div class="grid">
                    {#each openSurveys as survey (survey.id)}
                        <Card>
                            <div class="card-header">
                                <h3>{survey.title}</h3>
                                <button class="delete-btn" onclick={() => handleDelete(survey.slug)} title="Delete Survey">&times;</button>
                            </div>
                            <div class="card-meta">
                                <p>Slug: <code>/{survey.slug}</code></p>
                                {#if deletingSurveys.has(survey.slug)}
                                    <span class="telemetry-badge deleting">Deleting...</span>
                                {:else}
                                    <p>Questions Count: {survey.questions?.length || 0}</p>
                                    <p>Status: <span class="status {survey.status}">{survey.status}</span></p>
                                {/if}
                            </div>
                            <div class="card-actions">
                                <Button variant="secondary" href="/admin/{survey.slug}">Admin</Button>
                                <Button variant="primary" href="/{survey.slug}/survey">View Survey</Button>
                            </div>
                        </Card>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Closed Interactive Surveys -->
        {#if closedSurveys.length > 0}
            <section class="dashboard-section">
                <div class="section-header">
                    <h2>Closed Interactive Surveys</h2>
                    <a href="/dashboard/surveys/closed" class="view-all-link">View All</a>
                </div>
                <div class="grid">
                    {#each closedSurveys as survey (survey.id)}
                        <Card>
                            <div class="card-header">
                                <h3>{survey.title}</h3>
                                <button class="delete-btn" onclick={() => handleDelete(survey.slug)} title="Delete Survey">&times;</button>
                            </div>
                            <div class="card-meta">
                                <p>Slug: <code>/{survey.slug}</code></p>
                                {#if deletingSurveys.has(survey.slug)}
                                    <span class="telemetry-badge deleting">Deleting...</span>
                                {:else}
                                    <p>Questions Count: {survey.questions?.length || 0}</p>
                                    <p>Status: <span class="status {survey.status}">{survey.status}</span></p>
                                {/if}
                            </div>
                            <div class="card-actions">
                                <Button variant="secondary" href="/admin/{survey.slug}">Admin</Button>
                                <Button variant="primary" href="/{survey.slug}/survey">View Survey</Button>
                            </div>
                        </Card>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Uploaded Data Grid -->
        {#if uploadedSurveys.length > 0}
            <section class="dashboard-section">
                <div class="section-header">
                    <h2>Uploaded Data</h2>
                    <a href="/dashboard/uploads" class="view-all-link">View All</a>
                </div>
                <div class="grid">
                    {#each uploadedSurveys as survey (survey.id)}
                        {@const state = survey.telemetry ? evaluatePipelineState(survey.telemetry) : 'NOT_STARTED'}
                        <Card>
                            <div class="card-header">
                                <h3>{survey.title}</h3>
                                <button class="delete-btn" onclick={() => handleDelete(survey.slug)} title="Delete Survey">&times;</button>
                            </div>
                            <div class="card-meta">
                                <p>Slug: <code>/{survey.slug}</code></p>
                                {#if deletingSurveys.has(survey.slug)}
                                    <span class="telemetry-badge deleting">Deleting...</span>
                                {:else if survey.telemetry}
                                    <span class="telemetry-badge {state.toLowerCase()}">{survey.telemetry.status}</span>
                                {/if}
                            </div>
                            <div class="card-actions">
                                {#if state === 'RUNNING'}
                                    <Button variant="danger" onClick={() => surveyStore.cancelPipeline(survey.slug)}>Cancel</Button>
                                {:else if state === 'FAILED' || state === 'FAILED_ZOMBIE'}
                                    <Button variant="secondary" onClick={() => openReportModal(survey.slug, false)}>Resume</Button>
                                {:else if state === 'COMPLETED'}
                                    <Button variant="secondary" onClick={() => openReportModal(survey.slug, true)}>Regenerate Report</Button>
                                {:else}
                                    <Button variant="primary" onClick={() => openReportModal(survey.slug, false)}>Generate Report</Button>
                                {/if}

                                {#if survey.report_url}
                                    <ReportLink gsUrl={survey.report_url} />
                                {/if}
                            </div>
                        </Card>
                    {/each}
                </div>
            </section>
        {/if}
    {/if}
</div>

<!-- Modals -->
<CreateInteractiveModal bind:show={showInteractiveModal} />
<UploadDataModal bind:show={showUploadModal} />
<ReportConfigModal 
    bind:show={showReportModal} 
    slug={activeReportSlug} 
    purgeCheckpoints={activeReportPurge}
    onSubmit={(slug, payload, purge) => surveyStore.triggerPipeline(slug, payload, purge)}
/>

<style>
    .dashboard-container {
        max-width: var(--max-width);
        margin: 0 auto;
        padding: 2rem;
        font-family: var(--font-heading);
    }

    .dashboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--color-border);
    }

    .dashboard-header h1 {
        margin: 0 0 0.5rem 0;
        text-align: left;
    }

    .subtitle {
        color: var(--color-text-muted);
        margin: 0;
    }

    .action-buttons {
        display: flex;
        gap: 1rem;
    }

    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        background: var(--color-bg-surface);
        border-radius: 12px;
        border: 1px dashed var(--color-border);
    }

    .empty-state h3 {
        margin-top: 0;
    }

    .empty-state p {
        color: var(--color-text-muted);
        margin-bottom: 2rem;
    }

    .dashboard-section {
        margin-bottom: 3rem;
    }

    .dashboard-section h2 {
        margin: 0;
        color: var(--color-text-base);
    }
    
    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    }
    
    .view-all-link {
        color: var(--color-primary);
        text-decoration: none;
        font-weight: 500;
        font-size: 0.95rem;
    }
    
    .view-all-link:hover {
        text-decoration: underline;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
    }

    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
    }

    .card-header h3 {
        margin: 0;
        font-size: 1.25rem;
        color: var(--color-text-base);
    }

    .delete-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-size: 1.5rem;
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }

    .delete-btn:hover {
        color: var(--color-danger);
    }

    .card-meta {
        font-size: 0.9rem;
        color: var(--color-text-muted);
        margin-bottom: 1.5rem;
    }

    .card-meta p {
        margin: 0.5rem 0;
    }

    .card-meta code {
        background: var(--color-bg-surface);
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        font-family: monospace;
    }

    .status {
        font-weight: 500;
        text-transform: capitalize;
    }
    .status.open { color: var(--color-success); }
    .status.closed { color: var(--color-danger); }

    .telemetry-badge {
        display: inline-block;
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        margin-top: 0.5rem;
        color: white;
    }
    
    .telemetry-badge.completed { background: var(--color-success); }
    .telemetry-badge.failed, .telemetry-badge.failed_zombie { background: var(--color-danger); }
    .telemetry-badge.running { background: var(--color-info); }
    .telemetry-badge.deleting { background: var(--color-warning); color: black; }

    .card-actions {
        display: flex;
        gap: 1rem;
        border-top: 1px solid var(--color-border);
        padding-top: 1rem;
        margin-top: auto;
    }
    .card-actions :global(.clean-btn) {
        flex: 1;
    }
</style>
