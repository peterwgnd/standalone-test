import { writable } from 'svelte/store';
import { collection, onSnapshot, query, setDoc, doc, Timestamp, getDoc, updateDoc, where, orderBy, limit, serverTimestamp, writeBatch, deleteField } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../firebase/firebase-config';

const createSurveyStore = () => {
    const { subscribe, set, update } = writable({
        openSurveys: [],
        closedSurveys: [],
        uploadedSurveys: [],
        loading: true,
        error: null
    });

    let unsubOpen = null;
    let unsubClosed = null;
    let unsubUploaded = null;
    let adminUnsubs = new Map();

    return {
        subscribe,
        init: () => {
            if (typeof window !== 'undefined') {
                if (unsubOpen) unsubOpen();
                if (unsubClosed) unsubClosed();
                if (unsubUploaded) unsubUploaded();
                adminUnsubs.forEach(unsub => unsub());
                adminUnsubs.clear();

                const surveysRef = collection(db, 'surveys');
                
                const openQuery = query(surveysRef, where('type', '==', 'integrated'), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(3));
                const closedQuery = query(surveysRef, where('type', '==', 'integrated'), where('status', '==', 'closed'), orderBy('createdAt', 'desc'), limit(3));
                const uploadedQuery = query(surveysRef, where('type', '==', 'uploaded'), orderBy('createdAt', 'desc'), limit(3));
                
                let openLoaded = false, closedLoaded = false, uploadedLoaded = false;
                const checkDone = () => {
                    if (openLoaded && closedLoaded && uploadedLoaded) {
                        update(s => ({ ...s, loading: false }));
                    }
                };

                const syncAdminMetadata = (id, storeKey) => {
                    if (!adminUnsubs.has(id)) {
                        const adminRef = doc(db, 'surveys', id, 'admin', 'metadata');
                        const unsub = onSnapshot(adminRef, (adminSnap) => {
                            if (adminSnap.exists()) {
                                update(s => {
                                    const list = s[storeKey].map(survey => {
                                        if (survey.id === id) {
                                            return { ...survey, ...adminSnap.data() };
                                        }
                                        return survey;
                                    });
                                    return { ...s, [storeKey]: list };
                                });
                            }
                        });
                        adminUnsubs.set(id, unsub);
                    }
                };

                const handleSnapshot = async (snapshot, storeKey, loadCallback) => {
                    // Start listeners for real-time telemetry updates
                    snapshot.docs.forEach(docSnapshot => {
                        syncAdminMetadata(docSnapshot.id, storeKey);
                    });

                    // Initial fetch to prevent UI flickering
                    const data = await Promise.all(snapshot.docs.map(async docSnapshot => {
                        const s = { id: docSnapshot.id, ...docSnapshot.data() };
                        try {
                            const adminSnap = await getDoc(doc(db, 'surveys', docSnapshot.id, 'admin', 'metadata'));
                            if (adminSnap.exists()) Object.assign(s, adminSnap.data());
                        } catch (e) {
                            console.warn("Failed to fetch admin data for survey", docSnapshot.id, e);
                        }
                        return s;
                    }));
                    
                    update(s => {
                        const nextState = { ...s, [storeKey]: data, error: null };
                        const activeIds = new Set([
                            ...nextState.openSurveys.map(item => item.id),
                            ...nextState.closedSurveys.map(item => item.id),
                            ...nextState.uploadedSurveys.map(item => item.id)
                        ]);
                        for (const [id, unsub] of adminUnsubs.entries()) {
                            if (!activeIds.has(id)) {
                                unsub();
                                adminUnsubs.delete(id);
                            }
                        }
                        return nextState;
                    });
                    loadCallback();
                };

                unsubOpen = onSnapshot(openQuery, (snapshot) => {
                    handleSnapshot(snapshot, 'openSurveys', () => { openLoaded = true; checkDone(); });
                }, (error) => {
                    update(s => ({ ...s, loading: false, error: error.message }));
                });

                unsubClosed = onSnapshot(closedQuery, (snapshot) => {
                    handleSnapshot(snapshot, 'closedSurveys', () => { closedLoaded = true; checkDone(); });
                }, (error) => {
                    update(s => ({ ...s, loading: false, error: error.message }));
                });

                unsubUploaded = onSnapshot(uploadedQuery, (snapshot) => {
                    handleSnapshot(snapshot, 'uploadedSurveys', () => { uploadedLoaded = true; checkDone(); });
                }, (error) => {
                    update(s => ({ ...s, loading: false, error: error.message }));
                });

                return () => {
                    if (unsubOpen) unsubOpen();
                    if (unsubClosed) unsubClosed();
                    if (unsubUploaded) unsubUploaded();
                    adminUnsubs.forEach(unsub => unsub());
                    adminUnsubs.clear();
                };
            }
        },
        createInteractiveSurvey: async (surveyData) => {
            const docRef = doc(db, 'surveys', surveyData.slug);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                throw new Error("A survey with this slug already exists! Please choose a different slug.");
            }

            const batch = writeBatch(db);
            const adminRef = doc(db, 'surveys', surveyData.slug, 'admin', 'metadata');

            const { taskPrompt, ...publicData } = surveyData;

            batch.set(docRef, {
                ...publicData,
                type: 'integrated',
                status: 'open',
                createdAt: Timestamp.now()
            });
            batch.set(adminRef, {
                taskPrompt: taskPrompt || null
            });

            await batch.commit();
        },
        createUploadedSurvey: async (surveyData, fileBlob) => {
            const docRef = doc(db, 'surveys', surveyData.slug);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                throw new Error("A survey with this slug already exists! Please choose a different slug.");
            }

            const storageRef = ref(storage, `uploads/${surveyData.slug}/data.csv`);
            await uploadBytes(storageRef, fileBlob);
            const fileUri = `gs://${storage.app.options.storageBucket}/${storageRef.fullPath}`;

            const batch = writeBatch(db);
            const adminRef = doc(db, 'surveys', surveyData.slug, 'admin', 'metadata');

            batch.set(docRef, {
                ...surveyData,
                type: 'uploaded',
                status: 'closed',
                createdAt: Timestamp.now()
            });
            batch.set(adminRef, {
                file_uri: fileUri
            });

            await batch.commit();
        },
        deleteSurvey: async (surveySlug) => {
            const deleteFn = httpsCallable(functions, 'deleteSurvey');
            await deleteFn({ surveySlug });
        },
        triggerPipeline: async (surveySlug, configPayload, purgeCheckpoints = false) => {
            const adminRef = doc(db, 'surveys', surveySlug, 'admin', 'metadata');
            
            // Save config to Firestore right onto the Admin Metadata object
            await setDoc(adminRef, configPayload, { merge: true });

            // Set initial pending state to cover the Cloud Run cold start
            const initialUpdates = {
                telemetry: {
                    status: "Initializing pipeline...",
                    is_complete: false,
                    updated_at: serverTimestamp()
                }
            };
            if (purgeCheckpoints) {
                initialUpdates.report_url = deleteField();
                initialUpdates.intermediate_files = deleteField();
            }
            await setDoc(adminRef, initialUpdates, { merge: true });

            try {
                const triggerAnalyticsPipelineFn = httpsCallable(functions, 'triggerAnalyticsPipeline');
                await triggerAnalyticsPipelineFn({ 
                    surveySlug, 
                    model_name: configPayload.modelName,
                    additional_context: configPayload.additionalContext,
                    topics: configPayload.topics,
                    skip_autoraters: configPayload.skipAutoraters,
                    skip_quote_extraction: configPayload.skipQuoteExtraction,
                    purge_checkpoints: purgeCheckpoints 
                });
            } catch (err) {
                // Revert telemetry to a failed state if the function couldn't even trigger the job
                await setDoc(adminRef, {
                    telemetry: {
                        status: `Failed to start: ${err.message}`,
                        is_complete: false,
                        updated_at: serverTimestamp()
                    }
                }, { merge: true });
                throw err;
            }
        },
        cancelPipeline: async (surveySlug) => {
            try {
                const cancelAnalyticsPipelineFn = httpsCallable(functions, 'cancelAnalyticsPipeline');
                await cancelAnalyticsPipelineFn({ surveySlug });
            } catch (err) {
                // If the backend fails to cancel (e.g. no execution name because the job crashed early),
                // forcefully revert the UI state so the user isn't permanently locked out.
                const adminRef = doc(db, 'surveys', surveySlug, 'admin', 'metadata');
                await setDoc(adminRef, {
                    telemetry: {
                        status: "Canceled (Forced).",
                        is_complete: false,
                        updated_at: Timestamp.now()
                    }
                }, { merge: true });
                console.warn("Forced local cancel due to backend error:", err);
            }
        }
    };
};

export const surveyStore = createSurveyStore();
