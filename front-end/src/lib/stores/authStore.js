import { writable } from 'svelte/store';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase/firebase-config';

const createAuthStore = () => {
    /** @type {import('svelte/store').Writable<{user: import('firebase/auth').User | null, isAdmin: boolean, loading: boolean}>} */
    const { subscribe, set } = writable({
        user: null,
        isAdmin: false,
        loading: true
    });

    return {
        subscribe,
        _set: set,
        init: () => {
            if (typeof window !== 'undefined') {
                return onAuthStateChanged(auth, async (user) => {
                    let isAdmin = false;
                    if (user) {
                        try {
                            // Force token refresh on login to catch newly added claims
                            const tokenResult = await user.getIdTokenResult(true);
                            isAdmin = !!tokenResult.claims.admin;
                        } catch (e) {
                            console.error("Failed to fetch token claims:", e);
                        }
                    }
                    set({
                        user: user || null,
                        isAdmin: isAdmin,
                        loading: false
                    });
                });
            }
        },
        // For testing purposes
        _set: set
    };
};

export const authStore = createAuthStore();
