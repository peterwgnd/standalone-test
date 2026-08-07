<script>
    import { onMount } from 'svelte';
    import { collection, query, where, orderBy, limit, getDocs, startAfter, doc, getDoc } from 'firebase/firestore';
    import { db } from '$lib/firebase/firebase-config';
    import { surveyStore } from '$lib/stores/surveyStore';
    import { evaluatePipelineState } from '$lib/utils/pipeline';
    import { fetchServerTimeOffset } from '$lib/utils/time';
    import Card from '$lib/components/Card.svelte';
    import Button from '$lib/components/Button.svelte';
    import Badge from '$lib/components/Badge.svelte';
    import ReportConfigModal from '$lib/components/ReportConfigModal.svelte';
    import ReportLink from '$lib/components/ReportLink.svelte';

    let { title, type, status = null } = $props();

    let items = $state([]);
    let loading = $state(true);
    let error = $state(null);
    let lastVisible = $state(null);
    let hasMore = $state(true);

    let showReportModal = $state(false);
    let activeReportSlug = $state(null);
    let activeReportPurge = $state(false);
    let serverTimeOffset = $state(0);

    const PAGE_SIZE = 12;

    const loadMore = async () => {
        if (!hasMore) return;
        if (!loading && items.length > 0) loading = true;
        
        try {
            const surveysRef = collection(db, 'surveys');
            let q;
            if (status) {
                q = query(
                    surveysRef,
                    where('type', '==', type),
                    where('status', '==', status),
                    orderBy('createdAt', 'desc'),
                    limit(PAGE_SIZE)
                );
            } else {
                q = query(
                    surveysRef,
                    where('type', '==', type),
                    orderBy('createdAt', 'desc'),
                    limit(PAGE_SIZE)
                );
            }

            if (lastVisible) {
                q = query(q, startAfter(lastVisible));
            }

            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                hasMore = false;
            } else {
                lastVisible = snapshot.docs[snapshot.docs.length - 1];
                const newItems = await Promise.all(snapshot.docs.map(async docSnapshot => {
                    const s = { id: docSnapshot.id, ...docSnapshot.data() };
                    try {
                        const adminSnap = await getDoc(doc(db, 'surveys', docSnapshot.id, 'admin', 'metadata'));
                        if (adminSnap.exists()) Object.assign(s, adminSnap.data());
                    } catch (e) {
                        console.warn("Failed to fetch admin data for survey", docSnapshot.id, e);
                    }
                    return s;
                }));
                items = [...items, ...newItems];
                
                if (snapshot.docs.length < PAGE_SIZE) {
                    hasMore = false;
                }
            }
        } catch (err) {
            error = err.message;
        } finally {
            loading = false;
        }
    };

    onMount(() => {
        fetchServerTimeOffset().then(offset => {
            serverTimeOffset = offset;
        });

        loadMore();
    });

    let deletingSurveys = $state(new Set());

    const handleDelete = async (slug) => {
        if (confirm(`Are you sure you want to permanently delete /${slug}? This will erase all participant data, generated reports, and uploaded files. This cannot be undone.`)) {
            try {
                deletingSurveys.add(slug);
                deletingSurveys = new Set(deletingSurveys);
                
                await surveyStore.deleteSurvey(slug);
                items = items.filter(s => s.slug !== slug);
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
</script>

<svelte:head>
    <title>{title} | Sensemaking</title>
</svelte:head>

<div class="dashboard-container">
    <div class="dashboard-header">
        <div>
            <h1>{title}</h1>
            <a href="/dashboard" class="back-link">&larr; Back to Dashboard</a>
        </div>
    </div>

    {#if error}
        <div class="error-state">Error: {error}</div>
    {/if}

    <div class="grid">
        {#each items as survey (survey.id)}
            {@const state = survey.telemetry ? evaluatePipelineState(survey.telemetry) : 'NOT_STARTED'}
            <Card>
                <div class="card-header">
                    <h3>{survey.title}</h3>
                    <button class="delete-btn" onclick={() => handleDelete(survey.slug)} title="Delete Survey">&times;</button>
                </div>
                <div class="card-meta">
                    <p>Slug: <code>/{survey.slug}</code></p>
                    {#if deletingSurveys.has(survey.slug)}
                        <div style="margin-top: 0.5rem"><Badge variant="warning">Deleting...</Badge></div>
                    {:else if survey.type === 'integrated'}
                        <p>Questions Count: {survey.questions?.length || 0}</p>
                        <p>Status: <Badge variant={survey.status === 'open' ? 'success' : 'danger'}>{survey.status}</Badge></p>
                    {:else}
                        {#if survey.telemetry}
                            {@const stateLower = state.toLowerCase()}
                            {@const badgeVariant = stateLower === 'completed' ? 'success' : (stateLower === 'running' ? 'info' : 'danger')}
                            <div style="margin-top: 0.5rem"><Badge variant={badgeVariant}>{survey.telemetry.status}</Badge></div>
                        {/if}
                    {/if}
                </div>
                <div class="card-actions">
                    {#if survey.type === 'integrated'}
                        <Button variant="secondary" href="/admin/{survey.slug}">Admin</Button>
                        <Button variant="primary" href="/{survey.slug}/survey">View Survey</Button>
                    {:else}
                        {#if state === 'RUNNING'}
                            <Button variant="danger" disabled={!survey.telemetry?.execution_name} onClick={() => surveyStore.cancelPipeline(survey.slug)}>{survey.telemetry?.execution_name ? 'Cancel' : 'Initializing...'}</Button>
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
                    {/if}
                </div>
            </Card>
        {/each}
    </div>

    {#if loading}
        <div class="loading-state" style="margin-top: 2rem;">Loading more...</div>
    {:else if hasMore}
        <div class="load-more-container" style="text-align: center; margin-top: 2rem;">
            <Button variant="secondary" onClick={loadMore}>Load More</Button>
        </div>
    {:else if items.length === 0}
        <div class="empty-state">
            <p>No data found.</p>
        </div>
    {/if}
</div>

<ReportConfigModal 
    bind:show={showReportModal} 
    slug={activeReportSlug} 
    purgeCheckpoints={activeReportPurge}
    onSubmit={async (slug, payload, purge) => {
        await surveyStore.triggerPipeline(slug, payload, purge);
        const index = items.findIndex(s => s.slug === slug);
        if (index !== -1) {
            const updated = { ...items[index] };
            updated.telemetry = {
                status: "Initializing pipeline...",
                is_complete: false,
                updated_at: new Date()
            };
            if (purge) {
                delete updated.report_url;
            }
            items = [...items.slice(0, index), updated, ...items.slice(index + 1)];
        }
    }}
/>

<style>
    .dashboard-container { max-width: var(--max-width); margin: 0 auto; padding: 2rem; font-family: var(--font-heading); }
    .dashboard-header { margin-bottom: 3rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-border); }
    .dashboard-header h1 { margin: 0 0 0.5rem 0; color: var(--color-text-base); }
    .back-link { color: var(--color-text-muted); text-decoration: none; font-size: 0.95rem; }
    .back-link:hover { text-decoration: underline; color: var(--color-primary); }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
    .card-header h3 { margin: 0; font-size: 1.25rem; color: var(--color-text-base); }
    .delete-btn { background: none; border: none; color: var(--color-text-muted); font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1; }
    .delete-btn:hover { color: var(--color-danger); }
    .card-meta { font-size: 0.9rem; color: var(--color-text-muted); margin-bottom: 1.5rem; }
    .card-meta p { margin: 0.5rem 0; }
    .card-meta code { background: var(--color-bg-surface); padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
    .card-actions { display: flex; gap: 1rem; border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: auto; }
    .card-actions :global(.clean-btn) { flex: 1; }
</style>
