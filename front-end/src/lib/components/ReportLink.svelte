<script>
    import { ref, getDownloadURL } from 'firebase/storage';
    import { storage } from '$lib/firebase/firebase-config';
    import { onMount } from 'svelte';
    import Button from '$lib/components/Button.svelte';

    let { gsUrl = '' } = $props();
    let resolvedUrl = $state('');

    onMount(async () => {
        if (gsUrl) {
            try {
                const reportRef = ref(storage, gsUrl);
                resolvedUrl = await getDownloadURL(reportRef);
            } catch (err) {
                console.error("Failed to resolve report URL:", err);
            }
        }
    });
</script>

{#if resolvedUrl}
    <Button variant="primary" href={resolvedUrl} target="_blank">View Report</Button>
{/if}
