<script>
    import { onMount } from "svelte";
    import {
        collection,
        query,
        where,
        orderBy,
        limit,
        getDocs,
        startAfter,
    } from "firebase/firestore";
    import { db } from "$lib/firebase/firebase-config";
    import Card from "$lib/components/Card.svelte";
    import Button from "$lib/components/Button.svelte";

    let openSurveys = $state([]);
    let loading = $state(true);
    let error = $state(null);
    let lastVisible = $state(null);
    let hasMore = $state(true);

    const PAGE_SIZE = 12;

    const loadMore = async () => {
        if (!hasMore || (!loading && openSurveys.length > 0)) loading = true;

        try {
            const surveysRef = collection(db, "surveys");
            let q = query(
                surveysRef,
                where("type", "==", "integrated"),
                where("status", "==", "open"),
                orderBy("createdAt", "desc"),
                limit(PAGE_SIZE),
            );

            if (lastVisible) {
                q = query(q, startAfter(lastVisible));
            }

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                hasMore = false;
            } else {
                lastVisible = snapshot.docs[snapshot.docs.length - 1];
                const newItems = snapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                }));
                openSurveys = [...openSurveys, ...newItems];

                if (snapshot.docs.length < PAGE_SIZE) {
                    hasMore = false;
                }
            }
        } catch (err) {
            error = err.message;
        } finally {
            loading = false;
        }
    };

    onMount(() => {
        loadMore();
    });
</script>

<svelte:head>
    <title>Welcome | Sensemaking</title>
</svelte:head>

<div class="welcome-container">
    <div class="hero">
        <h1>Welcome!</h1>
        {#if openSurveys.length > 0}
            <p>The following surveys are now open:</p>
        {/if}
    </div>

    {#if error}
        <div class="error-state">Error: {error}</div>
    {/if}

    <div class="grid">
        {#each openSurveys as survey (survey.id)}
            <Card>
                <div class="card-content">
                    <h3>{survey.title}</h3>
                    <p class="meta">
                        Questions: {survey.questions?.length || 0}
                    </p>
                    <div class="actions">
                        <a href="/{survey.slug}/survey" class="take-survey-btn"
                            >Take Survey &rarr;</a
                        >
                    </div>
                </div>
            </Card>
        {/each}
    </div>

    {#if loading}
        <div class="loading-state">Loading active surveys...</div>
    {:else if hasMore}
        <div class="load-more-container">
            <Button variant="secondary" onClick={loadMore}>Load More</Button>
        </div>
    {:else if openSurveys.length === 0}
        <div class="empty-state">
            <p>There are no currently open surveys. Please check back later.</p>
        </div>
    {/if}
</div>

<style>
    .welcome-container {
        max-width: var(--max-width);
        margin: 0 auto;
        padding: 4rem 2rem;
        font-family: var(--font-heading);
    }

    .hero {
        text-align: center;
        margin-bottom: 4rem;
    }

    .hero h1 {
        font-size: 3rem;
        margin: 0 0 1rem 0;
        color: var(--color-primary);
    }

    .hero p {
        font-size: 1.25rem;
        color: var(--color-text-muted);
        margin: 0;
    }

    .loading-state,
    .load-more-container {
        text-align: center;
        margin-top: 2rem;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 2rem;
        max-width: 900px;
        margin: 0 auto;
    }

    .card-content h3 {
        margin: 0 0 1rem 0;
        font-size: 1.25rem;
        color: var(--color-text-base);
    }

    .meta {
        color: var(--color-text-muted);
        font-size: 0.9rem;
        margin-bottom: 1.5rem;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        border-top: 1px solid var(--color-border);
        padding-top: 1rem;
    }

    .take-survey-btn {
        display: inline-block;
        padding: 0.5rem 1.5rem;
        background: var(--color-primary);
        color: var(--color-secondary);
        text-decoration: none;
        border-radius: 8px;
        font-weight: 500;
        transition: opacity 0.2s;
    }

    .take-survey-btn:hover {
        opacity: 0.9;
    }
</style>
