import { describe, it, expect } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
    it('handles empty or non-string inputs', () => {
        expect(slugify('')).toBe('');
        expect(slugify(null)).toBe('');
        expect(slugify(undefined)).toBe('');
    });

    it('converts titles to lowercase hyphenated slugs', () => {
        expect(slugify('Downtown Transportation Survey 2026')).toBe('downtown-transportation-survey-2026');
    });

    it('strips special characters and punctuation', () => {
        expect(slugify('What do you think about NYC? (Phase 1!)')).toBe('what-do-you-think-about-nyc-phase-1');
    });

    it('collapses multiple whitespace and hyphens into single hyphens', () => {
        expect(slugify('  Survey   --  Name   ')).toBe('survey-name');
    });
});
