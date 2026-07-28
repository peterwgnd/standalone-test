<script>
    let { title = "", current = 0, total = 0 } = $props();
</script>

<div class="interview-header">
    <h1>{title}</h1>
    {#if total > 0}
        <div class="progress">
            Question {current} of {total}
        </div>
    {/if}
</div>

<style>
    .interview-header {
        text-align: center;
        margin-bottom: 3rem;
        font-family: var(--font-heading);
    }

    .interview-header h1 {
        color: var(--color-text-base);
        margin: 0 0 0.5rem 0;
    }

    .progress {
        color: var(--color-text-muted);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-size: 0.85rem;
    }
</style>
