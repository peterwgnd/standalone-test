<script>
    let { 
        id = '', 
        label = '', 
        value = $bindable(''),
        options = [], 
        required = false,
        ...rest
    } = $props();
</script>

<div class="input-group">
    {#if label}
        <label for={id}>{label}</label>
    {/if}
    <select 
        {id} 
        bind:value 
        {required} 
        class="clean-select" 
        {...rest}
    >
        {#each options as option}
            {#if typeof option === 'string'}
                <option value={option}>{option}</option>
            {:else}
                <option value={option.value}>{option.label}</option>
            {/if}
        {/each}
    </select>
</div>

<style>
    .input-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
        font-family: var(--font-heading);
    }

    label {
        font-weight: 500;
        color: var(--color-text-base);
        font-size: 0.9rem;
    }

    .clean-select {
        padding: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-family: var(--font-heading);
        font-size: 1rem;
        transition: border-color var(--transition-base);
        background-color: white;
        cursor: pointer;
    }

    .clean-select:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: var(--shadow-focus);
    }
</style>
