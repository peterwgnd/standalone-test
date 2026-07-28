<script>
    let { text = "", isLoading = false } = $props();
</script>

{#if isLoading}
    <div class="question-box skeleton-loader">
        <div class="skeleton-text line-1"></div>
        <div class="skeleton-text line-2"></div>
    </div>
{:else}
    <div class="question-box">
        <p class="question-text">{text}</p>
    </div>
{/if}

<style>
    .question-box {
        text-align: center;
        margin-bottom: 3rem;
        transition: opacity 0.3s ease;
    }

    .question-box .question-text {
        font-family: var(--font-heading);
        font-size: 1.75rem;
        color: var(--color-text-base);
        line-height: 1.4;
        font-weight: 500;
        margin: 0;
    }

    /* Skeleton Loader */
    .skeleton-loader {
        opacity: 0.7;
    }

    .skeleton-text {
        height: 2rem;
        background: linear-gradient(
            90deg,
            var(--color-bg-surface) 25%,
            var(--color-border) 50%,
            var(--color-bg-surface) 75%
        );
        background-size: 200% 100%;
        animation: loading 1.5s infinite;
        border-radius: var(--radius-sm);
    }

    .skeleton-text.line-1 {
        width: 80%;
        margin: 0 auto 0.5rem;
    }

    .skeleton-text.line-2 {
        width: 60%;
        margin: 0 auto;
    }

    @keyframes loading {
        0% {
            background-position: 200% 0;
        }
        100% {
            background-position: -200% 0;
        }
    }
</style>
