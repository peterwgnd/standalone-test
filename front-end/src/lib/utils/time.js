/**
 * @fileoverview Client-server time synchronization utility.
 * Calculates clock skew offset between client machine and server to prevent false zombie detections.
 */

/**
 * Fetches the server Date header via a lightweight HEAD request and calculates the millisecond offset.
 *
 * @param {string} [targetUrl] - URL to ping (defaults to current window location).
 * @returns {Promise<number>} Clock skew offset in milliseconds (serverTime - clientTime).
 */
export async function fetchServerTimeOffset(targetUrl) {
    if (typeof window === 'undefined') return 0;
    const url = targetUrl || window.location.href;
    try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        const dateHeader = res.headers.get('Date');
        if (dateHeader) {
            const serverTime = new Date(dateHeader).getTime();
            if (!isNaN(serverTime)) {
                return serverTime - Date.now();
            }
        }
    } catch (err) {
        console.warn('Failed to sync server time:', err);
    }
    return 0;
}
