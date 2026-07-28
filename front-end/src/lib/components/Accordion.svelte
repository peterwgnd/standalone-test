<script>
    let { 
        title = '', 
        open = false, 
        children 
    } = $props();
</script>

<details class="accordion-section" {open}>
    <summary>{title}</summary>
    <div class="accordion-content">
        {@render children()}
    </div>
</details>

<style>
    .accordion-section {
        margin-bottom: 1rem;
        background: var(--color-bg-base);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 1rem;
        font-family: var(--font-heading);
    }
    
    .accordion-section summary {
        font-weight: 600;
        cursor: pointer;
        outline: none;
    }

    .accordion-content {
        margin-top: 1rem;
    }
</style>
