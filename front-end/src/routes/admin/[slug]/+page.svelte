<script>
    import { page } from '$app/state';
    import { doc, getDoc, collection, onSnapshot, updateDoc, getCountFromServer, query, where } from 'firebase/firestore';
    import { db, functions } from '$lib/firebase/firebase-config';
    import { httpsCallable } from 'firebase/functions';
    import { surveyStore } from '$lib/stores/surveyStore';
    import Card from '$lib/components/Card.svelte';
    import Button from '$lib/components/Button.svelte';
    import Input from '$lib/components/Input.svelte';
    import Toggle from '$lib/components/Toggle.svelte';
    import ReportConfigModal from '$lib/components/ReportConfigModal.svelte';
    import ReportLink from '$lib/components/ReportLink.svelte';
    import { evaluatePipelineState } from '$lib/utils/pipeline';

    let slug = $derived(page.params.slug);

    let survey = $state(null);
    let loading = $state(true);
    let error = $state('');
    let responseCount = $state(0);
    let completedCount = $state(0);
    let startedCount = $state(0);
    
    let tokenLabel = $state('');
    let generatedLinks = $state([]);
    let tokenCount = $state(100);
    let isGeneratingTokens = $state(false);
    let tokenError = $state('');

    let showReportModal = $state(false);
    let activeReportSlug = $state(null);
    let activeReportPurge = $state(false);
    
    let serverTimeOffset = $state(0);

    $effect(() => {
        let unsubscribeSurvey;
        let unsubscribeAdmin;
        let pollInterval;
        let handleVisibilityChange;

        const init = async () => {
            try {
                loading = true;
                error = '';
                
                // Fetch server time to calculate client-side clock skew
                fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
                    .then(res => {
                        const dateHeader = res.headers.get('Date');
                        if (dateHeader) {
                            serverTimeOffset = new Date(dateHeader).getTime() - Date.now();
                        }
                    })
                    .catch(err => console.error("Failed to sync server time", err));

                const surveyRef = doc(db, "surveys", slug);
                const adminRef = doc(db, "surveys", slug, "admin", "metadata");
                
                // Fetch initial data so we don't render a null survey
                const [docSnap, adminSnap] = await Promise.all([getDoc(surveyRef), getDoc(adminRef)]);
                if (docSnap.exists()) {
                    survey = { ...docSnap.data(), ...(adminSnap.exists() ? adminSnap.data() : {}) };
                } else {
                    error = "Survey not found";
                    loading = false;
                    return;
                }

                let publicData = docSnap.exists() ? docSnap.data() : {};
                let adminData = adminSnap.exists() ? adminSnap.data() : {};

                const fetchResponseCounts = async (isPoll = false) => {
                    // Guard: Skip if polling while tab is hidden OR survey is closed
                    if (isPoll && (document.visibilityState !== 'visible' || survey?.status === 'closed')) {
                        return;
                    }
                    try {
                        const responsesRef = collection(db, 'surveys', slug, 'responses');
                        const [totalSnap, completedSnap] = await Promise.all([
                            getCountFromServer(responsesRef),
                            getCountFromServer(query(responsesRef, where('status', '==', 'completed')))
                        ]);
                        responseCount = totalSnap.data().count;
                        completedCount = completedSnap.data().count;
                        startedCount = Math.max(0, responseCount - completedCount);
                    } catch (err) {
                        console.error('Failed to fetch response counts:', err);
                    }
                };

                const updateSurveyState = () => {
                    survey = { ...publicData, ...adminData };
                };

                // Listen to survey document for real-time updates (like status toggles)
                unsubscribeSurvey = onSnapshot(surveyRef, (snapshot) => {
                    if (snapshot.exists()) {
                        publicData = snapshot.data();
                        updateSurveyState();
                    }
                });
                
                // Listen to admin metadata for pipeline telemetry
                unsubscribeAdmin = onSnapshot(adminRef, (snapshot) => {
                    if (snapshot.exists()) {
                        adminData = snapshot.data();
                        updateSurveyState();
                    }
                });
                
                fetchResponseCounts(false);

                pollInterval = setInterval(() => fetchResponseCounts(true), 60000);
                handleVisibilityChange = () => {
                    if (document.visibilityState === 'visible' && survey?.status !== 'closed') {
                        fetchResponseCounts(false);
                    }
                };
                document.addEventListener('visibilitychange', handleVisibilityChange);
                
                loading = false;
            } catch (err) {
                error = "Failed to load survey: " + err.message;
                loading = false;
            }
        };

        init();

        return () => {
            if (unsubscribeSurvey) unsubscribeSurvey();
            if (unsubscribeAdmin) unsubscribeAdmin();
            if (pollInterval) clearInterval(pollInterval);
            if (handleVisibilityChange) document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    });

    const generateLink = () => {
        if (!tokenLabel) return;
        const safeToken = tokenLabel.replace(/[^a-zA-Z0-9_-]/g, '');
        const host = window.location.origin;
        const newLink = `${host}/${slug}/survey?token=${safeToken}`;
        generatedLinks = [{ label: tokenLabel, url: newLink }, ...generatedLinks];
        tokenLabel = '';
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('Link copied to clipboard!');
    };

    const toggleStatus = async () => {
        if (!survey) return;
        const nextStatus = survey.status === 'open' ? 'closed' : 'open';
        try {
            await updateDoc(doc(db, "surveys", slug), { status: nextStatus });
        } catch (err) {
            alert("Failed to update status: " + err.message);
        }
    };
    
    const toggleSecurity = async () => {
        if (!survey) return;
        const nextStatus = !survey.requireValidToken;
        try {
            await updateDoc(doc(db, "surveys", slug), { requireValidToken: nextStatus });
        } catch (err) {
            alert("Failed to update security: " + err.message);
        }
    };

    const generateBulkTokens = async () => {
        if (tokenCount < 1 || tokenCount > 10000) {
            tokenError = "Please request between 1 and 10000 tokens.";
            return;
        }
        isGeneratingTokens = true;
        tokenError = '';
        try {
            const generateSurveyTokens = httpsCallable(functions, 'generateSurveyTokens');
            const result = await generateSurveyTokens({ slug, count: parseInt(tokenCount, 10) });
            const tokens = result.data.tokens;
            
            const host = window.location.origin;
            const csvContent = "data:text/csv;charset=utf-8," 
                + "Link\n"
                + tokens.map(t => `${host}/${slug}/survey?token=${t}`).join("\n");
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `survey_tokens_${slug}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert(`Successfully generated ${tokens.length} tokens and started CSV download!`);
        } catch (err) {
            tokenError = err.message;
        } finally {
            isGeneratingTokens = false;
        }
    };
    
    const openReportModal = (targetSlug, purge) => {
        activeReportSlug = targetSlug;
        activeReportPurge = purge;
        showReportModal = true;
    };

    let pipelineState = $derived(survey ? evaluatePipelineState(survey.telemetry) : 'NOT_STARTED');
</script>

<svelte:head>
    <title>{survey?.title || 'Survey'} Admin | Sensemaking</title>
</svelte:head>

<div class="admin-container">
    <a href="/dashboard" class="back-link">&larr; Back to Dashboard</a>

    {#if loading}
        <div class="loading-state">Loading...</div>
    {:else if error}
        <div class="error-state">{error}</div>
    {:else}
        <div class="admin-header">
            <div>
                <h1>{survey.title}</h1>
                <p class="subtitle">Workspace <code>/{slug}</code></p>
            </div>
            <div class="metrics-row">
                <div class="stat-badge">
                    <span class="stat-num">{responseCount}</span>
                    <span class="stat-label">Total</span>
                </div>
                <div class="stat-badge">
                    <span class="stat-num">{startedCount}</span>
                    <span class="stat-label">Started</span>
                </div>
                <div class="stat-badge">
                    <span class="stat-num">{completedCount}</span>
                    <span class="stat-label">Completed</span>
                </div>
            </div>
        </div>

        <div class="dashboard-grid">
            <Card>
                <h3 class="card-title">Survey Details</h3>
                <p><strong>Type:</strong> {survey.type}</p>
                <p>
                    <strong>Status:</strong> 
                    <span class="status {survey.status}">{survey.status}</span>
                </p>
                <div style="margin-top: 1rem; display: flex; gap: 1rem; align-items: center;">
                    <Button variant={survey.status === 'open' ? 'primary' : 'success'} onClick={toggleStatus}>
                        {survey.status === 'open' ? 'Close Survey' : 'Open Survey'}
                    </Button>
                    <Button variant="secondary" href="/{slug}/survey">View Survey</Button>
                </div>
                
                <h4 style="margin-top: 2rem; font-family: var(--font-heading);">Questions ({survey.questions?.length || 0})</h4>
                <ul class="questions-list">
                    {#each survey.questions || [] as q}
                        <li>{q}</li>
                    {/each}
                </ul>
            </Card>

            <div>
                <Card>
                    <h3 class="card-title">Report Generation</h3>
                    <p class="card-desc">Process the completed responses to identify thematic insights and points of consensus.</p>
                    
                    {#if survey.telemetry}
                        <div style="margin-bottom: 1rem;">
                            <span class="telemetry-badge {pipelineState.toLowerCase()}">
                                Pipeline: {survey.telemetry.status}
                            </span>
                        </div>
                    {/if}

                    <div class="pipeline-actions" style="display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
                        {#if pipelineState === 'RUNNING'}
                            <Button variant="danger" onClick={() => surveyStore.cancelPipeline(slug)}>Cancel</Button>
                        {:else if pipelineState === 'FAILED' || pipelineState === 'FAILED_ZOMBIE'}
                            <Button variant="secondary" onClick={() => openReportModal(slug, false)}>Resume</Button>
                        {:else if pipelineState === 'COMPLETED'}
                            <Button variant="secondary" onClick={() => openReportModal(slug, true)}>Regenerate Report</Button>
                        {:else}
                            <Button variant="primary" onClick={() => openReportModal(slug, false)}>Generate Report</Button>
                        {/if}

                        {#if survey.report_url}
                            <ReportLink gsUrl={survey.report_url} />
                        {/if}
                    </div>

                    {#if survey.intermediate_files && survey.intermediate_files.length > 0}
                        <div class="downloads-section">
                            <h4 style="margin-bottom: 0.5rem; color: var(--color-text-muted);">Intermediate Files</h4>
                            {#each survey.intermediate_files as fileUrl}
                                <div style="margin-bottom: 0.5rem;">
                                    <ReportLink gsUrl={fileUrl} label={`⬇ Download ${fileUrl.split('/').pop()}`} />
                                </div>
                            {/each}
                        </div>
                    {/if}
                </Card>

                <div style="margin-top: 2rem;">
                    <Card>
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <h3 class="card-title">Access Management & Tokens</h3>
                                <p class="card-desc">Control who can take this survey and generate unique invite links.</p>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.75rem; background: var(--bg-secondary); padding: 0.75rem 1rem; border-radius: 8px;">
                                <div style="display: flex; flex-direction: column;">
                                    <span style="font-weight: 600; font-size: 0.875rem;">Invite-Only Mode</span>
                                    <span style="font-size: 0.75rem; color: var(--text-secondary);">Enforce token validation</span>
                                </div>
                                <Toggle checked={survey.requireValidToken} onToggle={toggleSecurity} />
                            </div>
                        </div>
                        
                        <div style="margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
                            <h4>Generate Bulk Invites (CSV)</h4>
                            <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 1rem;">
                                Generate thousands of secure, single-use tokens at once. This will immediately download a CSV file of URLs that you can use in a Mail Merge.
                            </p>
                            <form onsubmit={(e) => { e.preventDefault(); generateBulkTokens(); }} style="display: flex; gap: 1rem; align-items: flex-start;">
                                <div style="flex: 1; max-width: 200px;">
                                    <Input id="count" type="number" min="1" max="10000" bind:value={tokenCount} disabled={isGeneratingTokens} />
                                    {#if tokenError}
                                        <div style="color: var(--danger-color); font-size: 0.75rem; margin-top: 0.5rem;">{tokenError}</div>
                                    {/if}
                                </div>
                                <Button variant="primary" type="submit" disabled={isGeneratingTokens}>
                                    {isGeneratingTokens ? 'Generating...' : 'Export to CSV'}
                                </Button>
                            </form>
                        </div>

                        <div style="margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
                            <h4>Generate Named Link (Manual)</h4>
                            <form onsubmit={(e) => { e.preventDefault(); generateLink(); }} class="generate-form" style="margin-top: 0.5rem;">
                                <div style="flex: 1;">
                                    <Input id="token" placeholder="Participant Token (e.g. subject-001)" bind:value={tokenLabel} />
                                </div>
                                <Button variant="secondary" type="submit" disabled={!tokenLabel}>Create Link</Button>
                            </form>

                            {#if generatedLinks.length > 0}
                                <div class="links-list">
                                    {#each generatedLinks as link}
                                        <div class="link-item">
                                            <div>
                                                <strong>{link.label}</strong>
                                                <code>{link.url}</code>
                                            </div>
                                            <Button variant="secondary" onClick={() => copyToClipboard(link.url)}>Copy</Button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    {/if}
</div>

<ReportConfigModal 
    bind:show={showReportModal} 
    slug={activeReportSlug} 
    purgeCheckpoints={activeReportPurge}
    onSubmit={(slug, payload, purge) => surveyStore.triggerPipeline(slug, payload, purge)}
/>

<style>
    .admin-container {
        max-width: var(--max-width);
        margin: 0 auto;
        padding: 2rem;
        font-family: var(--font-heading);
    }

    .back-link {
        display: inline-block;
        margin-bottom: 2rem;
        color: var(--color-text-muted);
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
    }

    .back-link:hover {
        color: var(--color-primary);
    }

    .admin-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid var(--color-border);
    }

    .admin-header h1 {
        margin: 0 0 0.5rem 0;
        color: var(--color-text-base);
    }

    .subtitle {
        color: var(--color-text-muted);
        margin: 0;
    }

    .metrics-row {
        display: flex;
        gap: 1rem;
    }

    .stat-badge {
        text-align: center;
        background: var(--color-bg-surface);
        padding: 1rem 1.5rem;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        min-width: 100px;
    }

    .stat-num {
        display: block;
        font-size: 2rem;
        font-weight: bold;
        color: var(--color-primary);
        line-height: 1;
    }

    .stat-label {
        font-size: 0.85rem;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .telemetry-badge {
        display: inline-block;
        padding: 0.3rem 0.6rem;
        border-radius: 4px;
        font-size: 0.85rem;
        margin-top: 0.5rem;
        color: white;
        font-weight: bold;
    }
    
    .telemetry-badge.completed { background: var(--color-success); }
    .telemetry-badge.failed, .telemetry-badge.failed_zombie { background: var(--color-danger); }
    .telemetry-badge.running { background: var(--color-info); }

    .status {
        font-weight: bold;
        text-transform: uppercase;
        font-size: 0.85rem;
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
    }
    .status.open { background: var(--color-success); color: white; }
    .status.closed { background: var(--color-danger); color: white; }

    .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
    }
    
    @media (max-width: 768px) {
        .dashboard-grid {
            grid-template-columns: 1fr;
        }
        .admin-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1.5rem;
        }
    }

    .card-title {
        margin-top: 0;
        margin-bottom: 0.5rem;
        color: var(--color-text-base);
    }

    .card-desc {
        color: var(--color-text-muted);
        margin-bottom: 1.5rem;
        font-size: 0.95rem;
        line-height: 1.5;
    }

    .generate-form {
        display: flex;
        gap: 1rem;
        align-items: flex-end;
    }

    .links-list {
        margin-top: 2rem;
        border-top: 1px solid var(--color-border);
        padding-top: 1.5rem;
    }

    .links-list h4 {
        margin-top: 0;
        margin-bottom: 1rem;
        color: var(--color-text-base);
    }

    .link-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--color-bg-surface);
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 0.75rem;
        border: 1px dashed var(--color-border);
    }

    .link-item strong {
        display: block;
        margin-bottom: 0.25rem;
        color: var(--color-text-base);
    }

    .link-item code {
        font-size: 0.8rem;
        color: var(--color-text-muted);
        word-break: break-all;
    }

    .questions-list {
        padding-left: 1.5rem;
        color: var(--color-text-muted);
    }

    .questions-list li {
        margin-bottom: 0.5rem;
        line-height: 1.4;
    }
    
    .downloads-section {
        margin-top: 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--color-border);
    }
</style>
