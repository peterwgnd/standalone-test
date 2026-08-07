/**
 * @fileoverview URL slug sanitization utility.
 * Transforms arbitrary user-provided titles into URL-safe, lowercase alphanumeric slugs.
 */

/**
 * Converts a string into a standardized, URL-safe slug.
 *
 * @param {string} text - Raw title or name.
 * @returns {string} Sanitized slug containing only lowercase alphanumeric characters and hyphens.
 */
export function slugify(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-');
}
