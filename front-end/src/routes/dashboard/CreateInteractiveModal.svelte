<script>
    import Modal from "$lib/components/Modal.svelte";
    import Input from "$lib/components/Input.svelte";
    import Textarea from "$lib/components/Textarea.svelte";
    import Button from "$lib/components/Button.svelte";
    import { surveyStore } from "$lib/stores/surveyStore";

    let { show = $bindable(false) } = $props();

    let name = $state("");
    let slug = $state("");
    let taskPrompt = $state("");
    let questions = $state([""]);
    let loading = $state(false);
    let error = $state("");

    let slugManuallyEdited = false;

    const handleNameInput = () => {
        if (!slugManuallyEdited) {
            slug = name
                .toLowerCase()
                .trim()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9-]/g, "");
        }
    };

    const handleSlugInput = () => {
        slugManuallyEdited = true;
    };

    const addQuestion = () => {
        if (questions.length >= 10) {
            error = "Surveys are limited to a maximum of 10 questions to ensure Firestore security rule coverage and LLM context limits.";
            return;
        }
        questions = [...questions, ""];
    };

    const removeQuestion = (index) => {
        if (questions.length > 1) {
            questions = questions.filter((_, i) => i !== index);
        } else {
            error = "You must include at least one question!";
        }
    };

    const handleSubmit = async () => {
        error = "";
        if (!name || !slug) {
            error = "Missing required fields (Name or Slug)!";
            return;
        }

        const validQuestions = questions.map((q) => q.trim()).filter(Boolean);
        if (validQuestions.length === 0) {
            error = "Missing required question list!";
            return;
        }
        if (validQuestions.length > 10) {
            error = "Surveys cannot have more than 10 questions.";
            return;
        }

        loading = true;
        try {
            await surveyStore.createInteractiveSurvey({
                title: name,
                slug: slug,
                taskPrompt: taskPrompt,
                questions: validQuestions,
            });
            show = false;
            // Reset form
            name = "";
            slug = "";
            taskPrompt = "";
            questions = [""];
            slugManuallyEdited = false;
        } catch (err) {
            error = err.message;
        } finally {
            loading = false;
        }
    };
</script>

<Modal bind:show title="Initialize New Workspace">
    {#if error}
        <div class="error-msg">{error}</div>
    {/if}

    <form
        onsubmit={(e) => {
            e.preventDefault();
            handleSubmit();
        }}
    >
        <Input
            id="surveyName"
            label="Workspace Name"
            bind:value={name}
            oninput={handleNameInput}
            required
        />
        <Input
            id="surveySlug"
            label="Workspace Slug (URL)"
            bind:value={slug}
            oninput={handleSlugInput}
            required
        />

        <Textarea
            id="taskPrompt"
            label="Survey Context and Goals for Follow Up Questions (Optional)"
            bind:value={taskPrompt}
            placeholder="Explain the purpose and intended goals for the survey here..."
            rows={3}
        />

        <div class="questions-section">
            <div class="pseudo-label">Survey Questions</div>
            {#each questions as question, i}
                <div class="question-row">
                    <Input
                        id={`q-${i}`}
                        placeholder={`Enter Question ${i + 1}`}
                        bind:value={questions[i]}
                        required
                    />
                    {#if questions.length > 1}
                        <button
                            type="button"
                            class="remove-btn"
                            onclick={() => removeQuestion(i)}>&times;</button
                        >
                    {/if}
                </div>
            {/each}
            <Button variant="secondary" onClick={addQuestion} disabled={questions.length >= 10} type="button"
                >+ Add Question {questions.length >= 10 ? '(Max 10)' : ''}</Button
            >
        </div>
    </form>

    {#snippet footerOptions()}
        <Button
            variant="secondary"
            onClick={() => (show = false)}
            disabled={loading}>Cancel</Button
        >
        <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? "Initializing..." : "Initialize Survey"}
        </Button>
    {/snippet}
</Modal>

<style>
    .error-msg {
        background: #fce8e6;
        color: var(--color-danger);
        padding: 0.75rem;
        border-radius: var(--radius-md);
        margin-bottom: 1rem;
        font-family: var(--font-heading);
    }

    .questions-section {
        margin-top: 1.5rem;
        font-family: var(--font-heading);
    }

    .questions-section .pseudo-label {
        display: block;
        font-weight: 500;
        color: var(--color-text-base);
        font-size: 0.9rem;
        margin-bottom: 0.5rem;
    }

    .question-row {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }

    /* Make the input take full width in the row */
    .question-row :global(.input-group) {
        flex: 1;
        margin-bottom: 0.5rem;
    }

    .remove-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-size: 1.5rem;
        cursor: pointer;
        padding: 0.5rem;
        line-height: 1;
    }

    .remove-btn:hover {
        color: var(--color-danger);
    }
</style>
