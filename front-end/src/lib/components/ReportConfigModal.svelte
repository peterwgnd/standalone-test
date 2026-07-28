<script>
    import Button from '$lib/components/Button.svelte';
    import Input from '$lib/components/Input.svelte';
    import Textarea from '$lib/components/Textarea.svelte';
    import Select from '$lib/components/Select.svelte';
    import Toggle from '$lib/components/Toggle.svelte';
    import Accordion from '$lib/components/Accordion.svelte';

    let { show = $bindable(), slug, purgeCheckpoints = false, onSubmit } = $props();

    let modelName = $state('gemini-3.5-flash');
    let additionalContext = $state('');
    let topics = $state('');
    let skipAutoraters = $state(true);
    let skipQuoteExtraction = $state(false);

    let reportLogo = $state('');
    let overviewChart = $state('toggle');
    let topOpinionsCount = $state(10);
    let sampleQuotesCount = $state(4);
    let excludedTopics = $state('');
    let excludedOpinions = $state('');

    let isSubmitting = $state(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!slug) return;
        
        isSubmitting = true;

        const payload = {
            modelName,
            additionalContext: additionalContext.trim(),
            topics: topics.trim(),
            skipAutoraters,
            skipQuoteExtraction,
            logo: reportLogo.trim(),
            overview_chart: overviewChart,
            number_of_top_opinions: topOpinionsCount,
            number_of_sample_quotes: sampleQuotesCount,
            excludedTopics: excludedTopics.split(',').map(s => s.trim()).filter(Boolean),
            excludedOpinions: excludedOpinions.split(',').map(s => s.trim()).filter(Boolean)
        };

        try {
            await onSubmit(slug, payload, purgeCheckpoints);
            show = false;
        } catch (err) {
            console.error("Error triggering report:", err);
            alert("Failed to start pipeline: " + err.message);
        } finally {
            isSubmitting = false;
        }
    };
</script>

{#if show}
<div class="modal-backdrop">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Configure Final Report</h3>
            <button class="close-btn" onclick={() => show = false}>&times;</button>
        </div>

        <form onsubmit={handleSubmit}>
            <Accordion title="Basic Options" open>
                
                <Input id="modelName" label="AI Model" bind:value={modelName} placeholder="gemini-3.5-flash" />

                <div class="form-group">
                    <Textarea 
                        id="additionalContext" 
                        label="Additional Context" 
                        bind:value={additionalContext} 
                        placeholder="Enter context to append to prompts..." 
                        rows={3} 
                    />
                    <span class="help-text">Passed to both categorization and report generation.</span>
                </div>
            </Accordion>

            <Accordion title="Categorization Options">
                
                <div class="form-group">
                    <Input id="topics" label="Predefined Topics (Comma-separated)" bind:value={topics} placeholder="e.g. Healthcare, Education" />
                    <span class="help-text">Forces the model to categorize within these buckets.</span>
                </div>

                <div class="form-group">
                    <Toggle id="skipAutoraters" label="Skip Autoraters" bind:checked={skipAutoraters} />
                    <span class="help-text helper-margin">Bypass LLM evaluation passes to save time and tokens.</span>
                </div>

                <div class="form-group">
                    <Toggle id="skipQuoteExtraction" label="Skip Quote Extraction" bind:checked={skipQuoteExtraction} />
                    <span class="help-text helper-margin">Use raw responses as quotes without truncation. Works best when participant responses are short.</span>
                </div>
            </Accordion>

            <Accordion title="Report Options">
                
                <Input id="reportLogo" label="Custom Header Logo URL (Optional)" bind:value={reportLogo} placeholder="https://yourdomain.com/logo.png" />

                <Select 
                    id="overviewChart" 
                    label="Overview Chart Style" 
                    bind:value={overviewChart} 
                    options={[
                        {value: 'toggle', label: 'Toggle (Topics & Opinions)'},
                        {value: 'topics', label: 'Topics Only'},
                        {value: 'opinions', label: 'Opinions Only'}
                    ]}
                />

                <Input type="number" id="topOpinionsCount" label="Number of Top Opinions to Display" bind:value={topOpinionsCount} min="2" max="20" />

                <Input type="number" id="sampleQuotesCount" label="Sample Quotes per Opinion" bind:value={sampleQuotesCount} min="2" max="10" />

                <Input id="excludedTopics" label="Excluded Topics (Comma-separated)" bind:value={excludedTopics} placeholder="e.g. Unknown, General Greetings" />

                <Input id="excludedOpinions" label="Excluded Opinions (Comma-separated)" bind:value={excludedOpinions} placeholder="e.g. Test Opinion" />
            </Accordion>

            <div class="modal-actions">
                <Button variant="secondary" onClick={() => show = false} type="button">Cancel</Button>
                <Button variant="primary" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Triggering...' : 'Begin Analysis'}
                </Button>
            </div>
        </form>
    </div>
</div>
{/if}

<style>
    .modal-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        padding: 1rem;
    }

    .modal-content {
        background: var(--color-bg-surface);
        padding: 2rem;
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    }

    .modal-header h3 { margin: 0; }
    
    .close-btn {
        background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted);
    }
    .form-group {
        margin-top: 1rem;
        margin-bottom: 1rem;
    }
    
    .help-text {
        display: block;
        font-size: 0.8rem;
        color: var(--color-text-muted);
        margin-top: 0.25rem;
    }

    .helper-margin {
        margin-top: -0.5rem;
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid var(--color-border);
    }
</style>
