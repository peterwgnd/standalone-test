import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from './authStore';

// Mock the firebase module
vi.mock('../firebase/firebase-config', () => ({
    auth: {}
}));

vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn((auth, callback) => {
        // Return a mock unsubscribe function
        return () => {};
    })
}));

describe('authStore', () => {
    beforeEach(() => {
        // Reset to initial state before each test
        authStore._set({ user: null, loading: true });
    });

    it('should have an initial state of loading=true and user=null', () => {
        const state = get(authStore);
        expect(state.loading).toBe(true);
        expect(state.user).toBeNull();
    });

    it('should update state when a user logs in via firebase', async () => {
        const { onAuthStateChanged } = await import('firebase/auth');
        
        // Mock the implementation to instantly fire the callback with a mock user
        onAuthStateChanged.mockImplementationOnce((auth, callback) => {
            callback({ uid: 'user_123', email: 'test@example.com' });
            return () => {};
        });

        // This would typically be called in +layout.svelte
        authStore.init();

        const state = get(authStore);
        expect(state.loading).toBe(false);
        expect(state.user).toEqual({ uid: 'user_123', email: 'test@example.com' });
    });

    it('should update state when a user logs out via firebase', async () => {
        const { onAuthStateChanged } = await import('firebase/auth');
        
        // Mock the implementation to instantly fire the callback with null
        onAuthStateChanged.mockImplementationOnce((auth, callback) => {
            callback(null);
            return () => {};
        });

        authStore.init();

        const state = get(authStore);
        expect(state.loading).toBe(false);
        expect(state.user).toBeNull();
    });
});
