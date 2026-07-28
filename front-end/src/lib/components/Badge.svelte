<script>
    let { 
        variant = 'neutral', // success, danger, warning, info, neutral
        children 
    } = $props();
</script>

<span class={`badge ${variant}`}>
    {@render children()}
</span>

<style>
    .badge {
        display: inline-block;
        padding: 0.2rem 0.5rem;
        border-radius: var(--radius-sm);
        font-size: 0.8rem;
        font-weight: 500;
        text-transform: capitalize;
    }

    .badge.success { background: var(--color-success); color: white; }
    .badge.danger { background: var(--color-danger); color: white; }
    .badge.warning { background: var(--color-warning); color: black; }
    .badge.info { background: var(--color-info); color: white; }
    .badge.neutral { background: var(--color-bg-surface); color: var(--color-text-muted); border: 1px solid var(--color-border); }
</style>
