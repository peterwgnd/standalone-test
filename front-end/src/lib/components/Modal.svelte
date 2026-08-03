<script>
    let { 
        show = $bindable(false), 
        title = '', 
        children, 
        footerOptions = undefined
    } = $props();

    let dialog = $state(null);

    $effect(() => {
        if (dialog) {
            if (show && !dialog.open) {
                dialog.showModal();
            } else if (!show && dialog.open) {
                dialog.close();
            }
        }
    });

    const close = () => {
        show = false;
    };
    
    const handleBackdropClick = (e) => {
        if (e.target === dialog) {
            close();
        }
    };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog 
    bind:this={dialog} 
    onclose={close} 
    onclick={handleBackdropClick}
    class="modal-content">
>
    <div class="modal-inner">
        <div class="modal-header">
            <h2>{title}</h2>
            <button class="close-btn" onclick={close} aria-label="Close modal">&times;</button>
        </div>
        
        <div class="modal-body">
            {@render children()}
        </div>
        
        {#if footerOptions}
            <div class="modal-footer">
                {@render footerOptions()}
            </div>
        {/if}
    </div>
</dialog>

<style>
    .modal-content {
        padding: 0;
        background: white;
        border: none;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        z-index: 1001;
        font-family: var(--font-heading);
    }
    
    .modal-content::backdrop {
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
    }
    
    .modal-inner {
        display: flex;
        flex-direction: column;
        max-height: 90vh;
    }

    .modal-content[open] {
        animation: scaleIn 0.15s ease-out forwards;
    }

    @keyframes scaleIn {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem;
        border-bottom: 1px solid var(--color-border);
    }

    .modal-header h2 {
        margin: 0;
        font-size: 1.25rem;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        color: var(--color-text-muted);
    }
    .close-btn:hover {
        color: var(--color-text-base);
    }

    .modal-body {
        padding: 1.5rem;
        overflow-y: auto;
    }

    .modal-footer {
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--color-border);
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        background: var(--color-bg-surface);
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
    }
</style>
