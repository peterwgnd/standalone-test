import { describe, it, expect } from 'vitest';
import { evaluatePipelineState } from './pipeline';

describe('evaluatePipelineState', () => {
    it('returns NOT_STARTED when telemetry is null or undefined', () => {
        expect(evaluatePipelineState(null)).toBe('NOT_STARTED');
        expect(evaluatePipelineState(undefined)).toBe('NOT_STARTED');
    });

    it('returns FAILED when status contains fail, error, or cancel', () => {
        expect(evaluatePipelineState({ status: 'FAILED_TO_START' })).toBe('FAILED');
        expect(evaluatePipelineState({ status: 'Container Error: OOM' })).toBe('FAILED');
        expect(evaluatePipelineState({ status: 'Canceled by user.' })).toBe('FAILED');
    });

    it('returns COMPLETED when is_complete is true', () => {
        expect(evaluatePipelineState({ status: 'Report Generated', is_complete: true })).toBe('COMPLETED');
    });

    it('returns RUNNING when updated recently within 15 minutes', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(evaluatePipelineState({
            status: 'RUNNING_STEP_2',
            is_complete: false,
            updated_at: fiveMinutesAgo
        })).toBe('RUNNING');

        // Firestore Timestamp object support (.toDate)
        expect(evaluatePipelineState({
            status: 'RUNNING_STEP_2',
            is_complete: false,
            updated_at: { toDate: () => fiveMinutesAgo }
        })).toBe('RUNNING');
    });

    it('returns FAILED_ZOMBIE when last updated >15 minutes ago', () => {
        const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
        expect(evaluatePipelineState({
            status: 'RUNNING_STEP_1',
            is_complete: false,
            updated_at: twentyMinutesAgo
        })).toBe('FAILED_ZOMBIE');
    });

    it('factors in serverTimeOffset correctly', () => {
        // If client clock is 10 minutes behind server, a 6-minute old server timestamp
        // might look like 16 minutes old locally without offset, but with offset it is recognized as RUNNING
        const clientNow = Date.now();
        const serverClockOffset = 10 * 60 * 1000; // Client is 10 mins behind
        const serverTimestamp = new Date(clientNow + serverClockOffset - 6 * 60 * 1000); // 6 mins old on server

        expect(evaluatePipelineState({
            status: 'RUNNING_STEP_3',
            is_complete: false,
            updated_at: serverTimestamp
        }, serverClockOffset)).toBe('RUNNING');
    });
});
