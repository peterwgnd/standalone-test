<script>
    let { 
        id = '', 
        label = '', 
        checked = $bindable(false),
        ...rest
    } = $props();
</script>

<div class="toggle-group">
    <label class="toggle-container" for={id}>
        <div class="toggle-label">{label}</div>
        <div class="toggle-wrapper">
            <input 
                type="checkbox" 
                {id} 
                bind:checked 
                class="toggle-checkbox" 
                {...rest}
            />
            <div class="toggle-switch"></div>
        </div>
    </label>
</div>

<style>
    .toggle-group {
        margin-bottom: 1rem;
        font-family: var(--font-heading);
    }

    .toggle-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        padding: 0.5rem 0;
    }

    .toggle-label {
        font-weight: 500;
        color: var(--color-text-base);
        font-size: 0.9rem;
    }

    .toggle-wrapper {
        position: relative;
        width: 44px;
        height: 24px;
    }

    .toggle-checkbox {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
    }

    .toggle-switch {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-border);
        border-radius: var(--radius-pill, 9999px);
        transition: background-color var(--transition-base);
    }

    .toggle-switch:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        border-radius: 50%;
        transition: transform var(--transition-base);
        box-shadow: var(--shadow-card);
    }

    .toggle-checkbox:checked + .toggle-switch {
        background-color: var(--color-primary); 
    }

    .toggle-checkbox:focus + .toggle-switch {
        box-shadow: var(--shadow-focus);
    }

    .toggle-checkbox:checked + .toggle-switch:before {
        transform: translateX(20px);
    }
</style>
