<script>
    import Button from '$lib/components/Button.svelte';

    let { 
        value = $bindable(""), 
        isSubmitting = false, 
        isAnalyzing = false,
        isFollowUp = false,
        followUpError = false,
        onSubmit,
        onSkip,
        onRetry
    } = $props();

    const handleKeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
        }
    };
</script>

<form class="input-area" onsubmit={(e) => { e.preventDefault(); onSubmit(); }}>
    <textarea
        bind:value={value}
        onkeydown={handleKeydown}
        placeholder={isAnalyzing ? "Analyzing your response..." : "Your thoughts here..."}
        disabled={isAnalyzing || isSubmitting}
        rows="4"
    ></textarea>

    <div class="actions">
        {#if followUpError}
            <div class="error-msg">
                Analysis failed or timed out.
            </div>
            <div class="error-actions">
                <Button variant="secondary" type="button" onClick={onSkip}>Skip</Button>
                <Button variant="primary" type="button" onClick={onRetry}>Retry</Button>
            </div>
        {:else}
            <Button
                variant="primary"
                type="submit"
                disabled={isAnalyzing || isSubmitting || !value.trim()}
            >
                {#if isSubmitting && !isFollowUp}
                    Saving Answer...
                {:else if isAnalyzing}
                    Analyzing...
                {:else if isFollowUp}
                    Submit Final Answer
                {:else}
                    Submit Answer
                {/if}
            </Button>
        {/if}
    </div>
</form>

<style>
    .input-area {
        background: var(--color-bg-surface);
        padding: 1.5rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
    }

    textarea {
        width: 100%;
        background: transparent;
        border: none;
        color: var(--color-text-base);
        font-family: inherit;
        font-size: 1.1rem;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        margin-bottom: 1rem;
    }

    textarea::placeholder {
        color: var(--color-text-muted);
        opacity: 0.7;
    }

    textarea:disabled {
        opacity: 0.6;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        border-top: 1px solid var(--color-border);
        padding-top: 1rem;
    }

    .error-msg {
        flex: 1;
        color: var(--color-danger);
        text-align: left;
        align-self: center;
        font-size: 0.9rem;
    }

    .error-actions {
        display: flex;
        gap: 0.5rem;
    }
</style>
