<script>
    let { 
        id = '', 
        label = '', 
        value = $bindable(''), 
        placeholder = '', 
        required = false,
        rows = 3,
        ...rest
    } = $props();
</script>

<div class="input-group">
    {#if label}
        <label for={id}>{label}</label>
    {/if}
    <textarea 
        {id} 
        {placeholder} 
        bind:value 
        {required}
        {rows}
        class="clean-textarea" 
        {...rest}
    ></textarea>
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

    .clean-textarea {
        padding: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-family: var(--font-heading);
        font-size: 1rem;
        transition: border-color var(--transition-base);
        resize: vertical;
    }

    .clean-textarea:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: var(--shadow-focus);
    }
</style>
