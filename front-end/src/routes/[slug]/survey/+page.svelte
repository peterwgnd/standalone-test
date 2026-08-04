<script>
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import {
        doc,
        getDoc,
        setDoc,
        updateDoc,
        onSnapshot,
        Timestamp,
    } from "firebase/firestore";
    import { db } from "$lib/firebase/firebase-config";
    import Button from "$lib/components/Button.svelte";
    import InterviewHeader from "$lib/components/InterviewHeader.svelte";
    import InterviewQuestion from "$lib/components/InterviewQuestion.svelte";
    import InterviewInput from "$lib/components/InterviewInput.svelte";

    let slug = $derived(page.params.slug);
    let paramToken = $derived(page.url.searchParams.get("token"));
    let sessionFallback = $state("");
    let token = $derived(paramToken || sessionFallback);

    onMount(() => {
        let stored = sessionStorage.getItem("survey_token");
        if (!stored) {
            stored = "anonymous-" + crypto.randomUUID();
            sessionStorage.setItem("survey_token", stored);
        }
        sessionFallback = stored;
    });

    let survey = $state(null);
    let loading = $state(true);
    let error = $state("");
    let status = $state("initializing"); // 'active', 'completed', 'closed'

    let currentQuestionIndex = $state(0);
    let questions = $state([]);

    let currentInput = $state("");
    let isSubmitting = $state(false);
    let isWaitingForFollowUp = $state(false);
    let followUpQuestion = $state(null);

    let responseRef;
    let unsubscribeResponse;
    
    let followUpTimeoutId = null;
    let followUpError = $state(false);

    $effect(() => {
        if (!token) return;
        const loadSurvey = async () => {
            try {
                loading = true;
                error = "";
                // Fetch survey
                const surveyDoc = await getDoc(doc(db, "surveys", slug));
            if (!surveyDoc.exists()) {
                error = "Survey not found";
                loading = false;
                return;
            }

            survey = surveyDoc.data();
            questions = survey.questions || [];

            if (survey.status === "closed") {
                status = "closed";
                loading = false;
                return;
            }

            if (survey.requireValidToken) {
                if (!paramToken) {
                    error = "This survey requires a valid invite token. Please check your link.";
                    loading = false;
                    return;
                }
                const tokenRef = doc(db, "surveys", slug, "respondents", paramToken);
                const tokenSnap = await getDoc(tokenRef);
                if (!tokenSnap.exists()) {
                    error = "Invalid or unrecognized invite token. Please check your link.";
                    loading = false;
                    return;
                }
            }

            // Init response document for this token
            responseRef = doc(db, "surveys", slug, "responses", token);
            const responseSnap = await getDoc(responseRef);

            if (responseSnap.exists()) {
                const resData = responseSnap.data();
                currentQuestionIndex = resData.currentQuestionIndex || 0;
                if (
                    resData.status === "completed" ||
                    currentQuestionIndex >= questions.length
                ) {
                    status = "completed";
                } else {
                    status = "active";
                    const currentAns = resData.answers ? resData.answers[currentQuestionIndex] : null;
                    if (currentAns && currentAns.answer && !currentAns.followUpAnswer) {
                        isWaitingForFollowUp = true;
                        if (currentAns.followUpQuestion) {
                            followUpQuestion = currentAns.followUpQuestion;
                        } else if (currentAns.error) {
                            followUpError = true;
                        } else {
                            // Re-establish listener if backend is still generating
                            if (unsubscribeResponse) unsubscribeResponse();
                            unsubscribeResponse = onSnapshot(responseRef, (docSnap) => {
                                if (docSnap.exists()) {
                                    const data = docSnap.data();
                                    const updatedAns = data.answers[currentQuestionIndex];
                                    if (updatedAns && updatedAns.error && isWaitingForFollowUp) {
                                        followUpError = true;
                                    } else if (updatedAns && updatedAns.followUpQuestion && isWaitingForFollowUp) {
                                        followUpQuestion = updatedAns.followUpQuestion;
                                        followUpError = false;
                                        if (unsubscribeResponse) unsubscribeResponse();
                                    }
                                }
                            });
                        }
                    }
                }
            } else {
                await setDoc(responseRef, {
                    participant_id: token,
                    status: "active",
                    currentQuestionIndex: 0,
                    createdAt: Timestamp.now(),
                    answers: {},
                });
                status = "active";
            }

            loading = false;
        } catch (err) {
            error = "Failed to load survey: " + err.message;
            loading = false;
        }
    };
        loadSurvey();

        return () => {
            if (unsubscribeResponse) unsubscribeResponse();
            if (followUpTimeoutId) clearTimeout(followUpTimeoutId);
        };
    });

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (!currentInput.trim() || isSubmitting) return;

        isSubmitting = true;

        try {
            if (!isWaitingForFollowUp) {
                // Turn 1: Initial Answer
                const questionText = questions[currentQuestionIndex];
                const updateObj = {};
                updateObj[`answers.${currentQuestionIndex}.question`] =
                    questionText;
                updateObj[`answers.${currentQuestionIndex}.answer`] =
                    currentInput;
                updateObj[`answers.${currentQuestionIndex}.timestamp`] =
                    Timestamp.now();
                updateObj.status = `pendingFollowUp_Q${currentQuestionIndex}`;

                await updateDoc(responseRef, updateObj);

                currentInput = "";
                isWaitingForFollowUp = true;

                // Ensure previous listeners are cleared before subscribing again
                if (unsubscribeResponse) {
                    unsubscribeResponse();
                }

                // Listen for Cloud Function to generate the follow-up
                unsubscribeResponse = onSnapshot(responseRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        const currentAns = data.answers[currentQuestionIndex];
                        
                        if (currentAns && currentAns.error && isWaitingForFollowUp) {
                            followUpError = true;
                            if (followUpTimeoutId) clearTimeout(followUpTimeoutId);
                        } else if (
                            currentAns &&
                            currentAns.followUpQuestion &&
                            isWaitingForFollowUp
                        ) {
                            followUpQuestion = currentAns.followUpQuestion;
                            followUpError = false;
                            if (followUpTimeoutId) clearTimeout(followUpTimeoutId);
                            if (unsubscribeResponse) unsubscribeResponse();
                            isSubmitting = false;
                        }
                    }
                });
                
                followUpTimeoutId = setTimeout(() => {
                    if (isWaitingForFollowUp && !followUpQuestion) {
                        followUpError = true;
                    }
                }, 20000);
            } else {
                // Turn 2: Follow-up Answer
                const updateObj = {};
                updateObj[`answers.${currentQuestionIndex}.followUpAnswer`] =
                    currentInput;
                updateObj[`answers.${currentQuestionIndex}.followUpTimestamp`] =
                    Timestamp.now();
                updateObj.currentQuestionIndex = currentQuestionIndex + 1;
                updateObj.status = `moved_to_Q${currentQuestionIndex + 1}`;

                await updateDoc(responseRef, updateObj);

                currentInput = "";
                isWaitingForFollowUp = false;
                followUpQuestion = null;
                currentQuestionIndex++;
                isSubmitting = false;

                if (currentQuestionIndex >= questions.length) {
                    await completeSurvey();
                }
            }
        } catch (e) {
            alert("Failed to save answer: " + e.message);
            isSubmitting = false;
        }
    };

    const completeSurvey = async () => {
        status = "completed";
        await updateDoc(responseRef, {
            status: "completed",
            completedAt: Timestamp.now(),
        });
    };
    
    const handleRetry = () => {
        followUpError = false;
        isWaitingForFollowUp = false;
        isSubmitting = false;
    };
    
    const handleSkipFollowUp = async () => {
        followUpError = false;
        isWaitingForFollowUp = false;
        followUpQuestion = null;
        currentInput = "";
        
        try {
            const updateObj = {};
            updateObj[`answers.${currentQuestionIndex}.skippedFollowUp`] = true;
            updateObj.currentQuestionIndex = currentQuestionIndex + 1;
            updateObj.status = `moved_to_Q${currentQuestionIndex + 1}`;

            await updateDoc(responseRef, updateObj);
            
            currentQuestionIndex++;
            isSubmitting = false;

            if (currentQuestionIndex >= questions.length) {
                await completeSurvey();
            }
        } catch (e) {
            alert("Failed to skip: " + e.message);
        }
    };

    const handleKeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };
</script>

<svelte:head>
    <title>{survey?.title ? survey.title + " | " : ""}Interview</title>
</svelte:head>

<div class="interview-container">
    {#if loading}
        <div class="center-message">Loading workspace...</div>
    {:else if error}
        <div class="center-message error">{error}</div>
    {:else if status === "closed"}
        <div class="center-message card">
            <h3>Survey Closed</h3>
            <p>This workspace is no longer accepting responses.</p>
        </div>
    {:else if status === "completed"}
        <div class="center-message card success">
            <h3 class="gradient-text">All Done!</h3>
            <p>
                Your responses have been securely saved and synchronized across
                your session workspace.
            </p>
            <p class="emoji">🎉</p>
        </div>
    {:else if status === "active"}
        <InterviewHeader 
            title={survey.title} 
            current={currentQuestionIndex + 1} 
            total={questions.length} 
        />

        <div class="chat-area">
            <InterviewQuestion 
                text={isWaitingForFollowUp ? followUpQuestion : questions[currentQuestionIndex]}
                isLoading={isWaitingForFollowUp && !followUpQuestion}
            />

            <InterviewInput
                bind:value={currentInput}
                isSubmitting={isSubmitting}
                isAnalyzing={isWaitingForFollowUp && !followUpQuestion}
                isFollowUp={isWaitingForFollowUp && !!followUpQuestion}
                followUpError={followUpError}
                onSubmit={handleSubmit}
                onSkip={handleSkipFollowUp}
                onRetry={handleRetry}
            />
        </div>
    {/if}
</div>

<style>
    .interview-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }

    .center-message {
        margin: auto;
        text-align: center;
        color: var(--color-text-muted);
        font-family: var(--font-heading);
    }

    .center-message.card {
        background: var(--color-bg-surface);
        padding: 3rem;
        border-radius: 16px;
        border: 1px solid var(--color-border);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
    }

    .center-message h3 {
        margin-top: 0;
        color: var(--color-text-base);
        font-size: 1.5rem;
    }

    .gradient-text {
        font-size: 2rem;
        background: linear-gradient(
            135deg,
            var(--color-accent) 0%,
            var(--color-info) 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 1rem;
    }

    .emoji {
        font-size: 3rem;
        margin-top: 1rem;
    }

    .chat-area {
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
</style>
