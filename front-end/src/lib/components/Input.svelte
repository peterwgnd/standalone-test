<script>
    let { 
        type = 'text', 
        id = '', 
        label = '', 
        value = $bindable(''), 
        placeholder = '', 
        required = false,
        ...rest
    } = $props();
</script>

<div class="input-group">
    {#if label}
        <label for={id}>{label}</label>
    {/if}
    <input 
        {type} 
        {id} 
        {placeholder} 
        bind:value 
        {required} 
        class="clean-input" 
        {...rest}
    />
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

    .clean-input {
        padding: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-family: var(--font-heading);
        font-size: 1rem;
        transition: border-color var(--transition-base);
    }

    .clean-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: var(--shadow-focus);
    }
</style>
