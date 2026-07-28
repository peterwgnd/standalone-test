<script>
    let { 
        type = 'button', 
        variant = 'primary', // primary, secondary, danger, etc.
        disabled = false, 
        href = null,
        target = null,
        onClick = undefined, 
        children 
    } = $props();
</script>

{#if href}
    <a 
        {href}
        {target}
        class="clean-btn btn-{variant}" 
        class:disabled={disabled}
        onclick={(e) => {
            if (disabled) {
                e.preventDefault();
                return;
            }
            if (onClick) onClick(e);
        }}
    >
        {@render children()}
    </a>
{:else}
    <button 
        {type} 
        class="clean-btn btn-{variant}" 
        {disabled} 
        onclick={onClick}
    >
        {@render children()}
    </button>
{/if}

<style>
    .clean-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 8px;
        font-family: var(--font-heading);
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-decoration: none;
        text-align: center;
        transition: opacity 0.2s, background 0.2s;
    }
    
    .clean-btn:hover {
        opacity: 0.9;
    }
    
    .clean-btn:disabled, .clean-btn.disabled {
        opacity: 0.6;
        cursor: not-allowed;
        pointer-events: none;
    }

    .btn-primary {
        background: var(--color-primary);
        color: white;
        border: 1px solid var(--color-primary);
    }

    .btn-secondary {
        background: white;
        color: var(--color-primary);
        border: 1px solid var(--color-primary);
    }
    
    .btn-danger {
        background: var(--color-danger);
        color: white;
        border: 1px solid var(--color-danger);
    }
</style>
