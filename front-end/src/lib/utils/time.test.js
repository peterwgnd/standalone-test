import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchServerTimeOffset } from './time';

describe('fetchServerTimeOffset', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('calculates clock skew offset from server Date header', async () => {
        const clientNow = Math.floor(Date.now() / 1000) * 1000;
        const serverDate = new Date(clientNow + 5000).toUTCString(); // Server is exactly 5s ahead

        global.fetch = vi.fn().mockResolvedValue({
            headers: {
                get: (header) => (header.toLowerCase() === 'date' ? serverDate : null)
            }
        });

        const offset = await fetchServerTimeOffset('https://example.com');
        // HTTP Date headers have 1-second resolution
        expect(Math.abs(offset - 5000)).toBeLessThan(1000);
    });

    it('returns 0 when fetch fails or Date header is missing', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
        const offset = await fetchServerTimeOffset('https://example.com');
        expect(offset).toBe(0);
    });
});
