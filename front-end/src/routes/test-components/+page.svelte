<script>
    import Button from "$lib/components/Button.svelte";
    import Input from "$lib/components/Input.svelte";
    import Textarea from "$lib/components/Textarea.svelte";
    import Select from "$lib/components/Select.svelte";
    import Toggle from "$lib/components/Toggle.svelte";
    import Accordion from "$lib/components/Accordion.svelte";
    import Card from "$lib/components/Card.svelte";
    import Badge from "$lib/components/Badge.svelte";
    import Modal from "$lib/components/Modal.svelte";
    import InterviewHeader from "$lib/components/InterviewHeader.svelte";
    import InterviewQuestion from "$lib/components/InterviewQuestion.svelte";
    import InterviewInput from "$lib/components/InterviewInput.svelte";

    let showModal = $state(false);
    let inputValue = $state("");
    let toggleState = $state(false);
    let selectValue = $state("option1");
    let interviewInput = $state("");
</script>

<svelte:head>
    <title>Component Style Guide</title>
</svelte:head>

<div class="style-guide">
    <h1>Component Style Guide</h1>
    <p>A living catalog of all UI components.</p>

    <section>
        <h2>1. Typography & Colors</h2>
        <div class="swatches">
            <div
                class="swatch"
                style="background: var(--color-primary); color: white;"
            >
                Primary
            </div>
            <div
                class="swatch"
                style="background: var(--color-secondary); color: white;"
            >
                Secondary
            </div>
            <div
                class="swatch"
                style="background: var(--color-danger); color: white;"
            >
                Danger
            </div>
            <div
                class="swatch"
                style="background: var(--color-success); color: white;"
            >
                Success
            </div>
            <div
                class="swatch"
                style="background: var(--color-warning); color: black;"
            >
                Warning
            </div>
            <div
                class="swatch"
                style="background: var(--color-info); color: white;"
            >
                Info
            </div>
            <div
                class="swatch"
                style="background: var(--color-bg-base); color: var(--color-text-base); border: 1px solid var(--color-border);"
            >
                Bg Base
            </div>
            <div
                class="swatch"
                style="background: var(--color-bg-surface); color: var(--color-text-base); border: 1px solid var(--color-border);"
            >
                Bg Surface
            </div>
        </div>
        <div style="margin-top: 1rem;">
            <h1 style="margin: 0;">Heading 1 (var(--font-heading))</h1>
            <h2 style="margin: 0;">Heading 2</h2>
            <h3 style="margin: 0;">Heading 3</h3>
            <p style="margin: 0;">
                Regular paragraph text (var(--font-body)). <strong
                    >Bold text.</strong
                > <em>Italic text.</em>
            </p>
        </div>
    </section>

    <section>
        <h2>2. Buttons</h2>
        <div class="component-row">
            <Button variant="primary" onClick={() => alert("Primary clicked!")}
                >Primary Button</Button
            >
            <Button
                variant="secondary"
                onClick={() => alert("Secondary clicked!")}
                >Secondary Button</Button
            >
            <Button variant="danger" onClick={() => alert("Danger clicked!")}
                >Danger Button</Button
            >
            <Button variant="primary" disabled={true}>Disabled</Button>
        </div>
    </section>

    <section>
        <h2>3. Form Controls</h2>
        <div class="form-container">
            <Input
                id="test-input"
                label="Standard Input"
                bind:value={inputValue}
                placeholder="Type something..."
            />

            <Textarea
                id="test-textarea"
                label="Standard Textarea"
                bind:value={inputValue}
                placeholder="Type a lot..."
                rows={3}
            />

            <Select
                id="test-select"
                label="Standard Select"
                bind:value={selectValue}
                options={[
                    { value: "option1", label: "Option 1" },
                    { value: "option2", label: "Option 2" },
                    { value: "option3", label: "Option 3" },
                ]}
            />

            <div style="margin-top: 1rem;">
                <Toggle
                    id="test-toggle"
                    label="Standard Toggle"
                    bind:checked={toggleState}
                />
                <p
                    style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;"
                >
                    Toggle is {toggleState ? "ON" : "OFF"}
                </p>
            </div>
        </div>
    </section>

    <section>
        <h2>4. Dashboard UI</h2>

        <h3 style="margin-top: 0;">Badges</h3>
        <div class="component-row" style="margin-bottom: 2rem;">
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="info">Info</Badge>
        </div>

        <h3 style="margin-top: 0;">Accordion</h3>
        <div style="max-width: 600px; margin-bottom: 2rem;">
            <Accordion title="Click to expand me" open={false}>
                <p style="margin: 0;">
                    This is the hidden content inside the accordion. It uses a
                    nice variable-based radius and border.
                </p>
            </Accordion>
            <Accordion title="I am open by default" open={true}>
                <p style="margin: 0;">Hello there!</p>
            </Accordion>
        </div>

        <h3 style="margin-top: 0;">Card</h3>
        <div style="max-width: 400px; margin-bottom: 2rem;">
            <Card>
                <div
                    style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;"
                >
                    <h3 style="margin: 0; font-family: var(--font-heading);">
                        Example Survey
                    </h3>
                    <Badge variant="success">Active</Badge>
                </div>
                <p
                    style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1.5rem;"
                >
                    This is what a card looks like in the dashboard grid.
                </p>
                <div
                    style="border-top: 1px solid var(--color-border); padding-top: 1rem; display: flex; gap: 1rem;"
                >
                    <Button variant="secondary">Cancel</Button>
                    <Button variant="primary">Submit</Button>
                </div>
            </Card>
        </div>

        <h3 style="margin-top: 0;">Modal</h3>
        <Button variant="primary" onClick={() => (showModal = true)}
            >Open Test Modal</Button
        >

        <Modal bind:show={showModal} title="Test Modal">
            <p>
                This is the body of the modal. It's clean, animated, and
                isolates the layout.
            </p>

            {#snippet footerOptions()}
                <Button variant="secondary" onClick={() => (showModal = false)}
                    >Cancel</Button
                >
                <Button variant="primary" onClick={() => (showModal = false)}
                    >Confirm Action</Button
                >
            {/snippet}
        </Modal>
    </section>

    <section>
        <h2>5. Survey UI (Interview mode)</h2>
        <div class="survey-sandbox">
            <InterviewHeader
                title="Public Transportation Survey"
                current={2}
                total={5}
            />

            <div style="margin-bottom: 2rem;">
                <h3
                    style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1rem;"
                >
                    Loading State
                </h3>
                <InterviewQuestion isLoading={true} />
            </div>

            <div style="margin-bottom: 2rem;">
                <h3
                    style="text-align: center; color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1rem;"
                >
                    Loaded State
                </h3>
                <InterviewQuestion
                    text="What are your thoughts on expanding the light rail system?"
                    isLoading={false}
                />
            </div>

            <InterviewInput
                bind:value={interviewInput}
                onSubmit={() => alert("Submitted: " + interviewInput)}
            />
        </div>
    </section>
</div>

<style>
    .style-guide {
        max-width: 1000px;
        margin: 0 auto;
        padding: 3rem 2rem;
    }

    h1 {
        margin-top: 0;
        margin-bottom: 0.5rem;
        font-family: var(--font-heading);
    }

    .style-guide > p {
        color: var(--color-text-muted);
        margin-bottom: 3rem;
        font-size: 1.1rem;
    }

    section {
        margin-bottom: 4rem;
        padding-bottom: 2rem;
        border-bottom: 1px dashed var(--color-border);
    }

    section h2 {
        font-family: var(--font-heading);
        color: var(--color-primary);
        margin-top: 0;
        margin-bottom: 1.5rem;
    }

    .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
    }

    .swatch {
        width: 100px;
        height: 100px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-md);
        font-weight: bold;
        font-size: 0.9rem;
        text-align: center;
        padding: 0.5rem;
    }

    .component-row {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
    }

    .form-container {
        max-width: 500px;
        background: var(--color-bg-surface);
        padding: 2rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
    }

    .survey-sandbox {
        background: var(--color-bg);
        padding: 2rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-modal);
    }
</style>
