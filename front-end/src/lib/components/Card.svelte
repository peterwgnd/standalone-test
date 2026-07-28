<script>
    let { children } = $props();
</script>

<div class="clean-card">
    {@render children()}
</div>

<style>
    .clean-card {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0, 0, 0, 0.05);
        font-family: var(--font-heading);
    }
</style>
