/**
 * Evaluates the pipeline execution state from Firestore telemetry.
 *
 * @param {Object|null} telemetry - The telemetry object from admin/metadata.
 * @param {number} [serverTimeOffset=0] - The offset in milliseconds between server time and local time.
 * @returns {string} The computed state: 'NOT_STARTED', 'COMPLETED', 'FAILED', 'FAILED_ZOMBIE', or 'RUNNING'.
 */
export function evaluatePipelineState(telemetry, serverTimeOffset = 0) {
    if (!telemetry) return 'NOT_STARTED';
    
    const statusText = (telemetry.status || '').toLowerCase();
    if (statusText.includes('fail') || statusText.includes('error') || statusText.includes('cancel')) {
        return 'FAILED';
    }

    if (telemetry.is_complete) return 'COMPLETED';

    if (telemetry.updated_at) {
        let updatedTime;
        if (telemetry.updated_at.toDate) {
            updatedTime = telemetry.updated_at.toDate();
        } else if (telemetry.updated_at.seconds) {
            updatedTime = new Date(telemetry.updated_at.seconds * 1000);
        } else {
            updatedTime = new Date(telemetry.updated_at);
        }

        if (!isNaN(updatedTime.getTime())) {
            const now = new Date(Date.now() + serverTimeOffset);
            const diffMinutes = (now - updatedTime) / (1000 * 60);
            if (diffMinutes > 15) {
                return 'FAILED_ZOMBIE';
            }
            return 'RUNNING';
        }
    }

    return 'FAILED_ZOMBIE';
}
