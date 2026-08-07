<script>
    import Modal from '$lib/components/Modal.svelte';
    import Input from '$lib/components/Input.svelte';
    import Select from '$lib/components/Select.svelte';
    import Button from '$lib/components/Button.svelte';
    import { surveyStore } from '$lib/stores/surveyStore';
    import { slugify } from '$lib/utils/slug';
    import Papa from 'papaparse';

    let { show = $bindable(false) } = $props();

    let name = $state('');
    let slug = $state('');
    let loading = $state(false);
    let error = $state('');
    let file = $state(null);
    let fileInput = $state(null);
    
    let requiresMapping = $state(false);
    let headers = $state([]);
    let mapPid = $state('');
    let mapText = $state('');

    let slugManuallyEdited = false;

    const handleNameInput = () => {
        if (!slugManuallyEdited) {
            slug = slugify(name);
        }
    };

    const handleSlugInput = () => {
        slugManuallyEdited = true;
    };

    const MAX_FILE_SIZE_MB = 25;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

    const handleFileChange = (e) => {
        error = '';
        file = e.target.files[0];
        if (!file) {
            requiresMapping = false;
            return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            error = `File size exceeds the ${MAX_FILE_SIZE_MB}MB limit. Please upload a smaller file.`;
            file = null;
            if (fileInput) fileInput.value = '';
            requiresMapping = false;
            return;
        }

        Papa.parse(file, {
            preview: 1,
            complete: (results) => {
                headers = results.data[0] || [];
                const hasPid = headers.includes('participant_id');
                const hasText = headers.includes('survey_text');

                if (hasPid && hasText) {
                    requiresMapping = false;
                } else {
                    requiresMapping = true;
                    const idGuess = headers.find(h => h.toLowerCase().includes('id') || h.toLowerCase().includes('participant'));
                    const textGuess = headers.find(h => h.toLowerCase().includes('text') || h.toLowerCase().includes('message') || h.toLowerCase().includes('verbatim'));
                    
                    mapPid = idGuess || headers[0];
                    mapText = textGuess || headers[0];
                }
            },
            error: (err) => {
                error = "Error reading CSV file!";
                console.error(err);
            }
        });
    };

    const handleSubmit = async () => {
        error = '';
        if (!name || !slug) {
            error = "Missing required fields (Name or Slug)!";
            return;
        }
        if (!file) {
            error = "Please select a CSV file to upload!";
            return;
        }

        loading = true;
        try {
            let fileBlob = file;

            if (requiresMapping) {
                fileBlob = await new Promise((resolve, reject) => {
                    Papa.parse(file, {
                        header: true,
                        complete: (results) => {
                            const transformedData = results.data.map(row => {
                                if (!row[mapPid] && !row[mapText]) return null;
                                return {
                                    ...row,
                                    participant_id: row[mapPid] || '',
                                    survey_text: row[mapText] || ''
                                };
                            }).filter(Boolean);

                            const csvString = Papa.unparse(transformedData);
                            resolve(new Blob([csvString], { type: 'text/csv' }));
                        },
                        error: reject
                    });
                });
            }

            await surveyStore.createUploadedSurvey({
                title: name,
                slug: slug
            }, fileBlob);
            
            show = false;
            // Reset
            name = '';
            slug = '';
            file = null;
            if (fileInput) fileInput.value = '';
            requiresMapping = false;
            slugManuallyEdited = false;
        } catch (err) {
            error = err.message;
        } finally {
            loading = false;
        }
    };
</script>

<Modal bind:show title="Upload Survey Data">
    {#if error}
        <div class="error-msg">{error}</div>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <Input id="uploadName" label="Workspace Name" bind:value={name} oninput={handleNameInput} required />
        <Input id="uploadSlug" label="Workspace Slug (URL)" bind:value={slug} oninput={handleSlugInput} required />
        
        <div class="input-group">
            <label for="csvUpload">CSV File</label>
            <input 
                type="file" 
                id="csvUpload" 
                accept=".csv" 
                onchange={handleFileChange} 
                bind:this={fileInput}
                class="clean-file-input"
            />
        </div>

        {#if requiresMapping}
            <div class="mapping-section">
                <p class="mapping-warning">Required headers <code>participant_id</code> and <code>survey_text</code> not found. Please map them below:</p>
                <Select
                    id="mapPid"
                    label="Map Participant ID to:"
                    bind:value={mapPid}
                    options={headers}
                />
                <Select
                    id="mapText"
                    label="Map Survey Text to:"
                    bind:value={mapText}
                    options={headers}
                />
            </div>
        {/if}
    </form>

    {#snippet footerOptions()}
        <Button variant="secondary" onClick={() => show = false} disabled={loading}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={loading || !file}>
            {loading ? 'Uploading...' : 'Upload & Initialize'}
        </Button>
    {/snippet}
</Modal>

<style>
    .error-msg {
        background: #fce8e6;
        color: var(--color-danger);
        padding: 0.75rem;
        border-radius: var(--radius-md);
        margin-bottom: 1rem;
        font-family: var(--font-heading);
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
        font-family: var(--font-heading);
    }

    .input-group label {
        font-weight: 500;
        color: var(--color-text-base);
        font-size: 0.9rem;
    }

    .clean-file-input {
        padding: 0.5rem 0;
        font-family: var(--font-heading);
    }

    .mapping-section {
        background: #f8fafc;
        border: 1px solid var(--color-border);
        padding: 1rem;
        border-radius: var(--radius-md);
        margin-top: 1rem;
        font-family: var(--font-heading);
    }

    .mapping-warning {
        font-size: 0.85rem;
        color: var(--color-warning);
        margin-top: 0;
        margin-bottom: 1rem;
    }
</style>
