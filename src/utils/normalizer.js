const { URL } = require('url');

/**
 * Tracking parameters to strip from URLs
 */
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
    '_ga', '_gl', 'yclid', 'msclkid',
]);

/**
 * Normalize a URL to a canonical form for deduplication.
 * Rules:
 *  1. Lowercase
 *  2. Force https://
 *  3. Remove www.
 *  4. Remove trailing slashes
 *  5. Remove default ports
 *  6. Sort query params
 *  7. Strip tracking params
 *  8. Remove fragment
 *
 * @param {string} rawUrl
 * @returns {string|null} Normalized URL or null if invalid
 */
function normalizeUrl(rawUrl) {
    try {
        const url = new URL(rawUrl.trim().toLowerCase());

        // Force https
        url.protocol = 'https:';

        // Strip www
        url.hostname = url.hostname.replace(/^www\./, '');

        // Remove trailing slashes (keep root /)
        url.pathname = url.pathname.replace(/\/+$/, '') || '/';

        // Remove default ports
        url.port = '';

        // Sort query params
        url.searchParams.sort();

        // Remove tracking params
        for (const param of TRACKING_PARAMS) {
            url.searchParams.delete(param);
        }

        // Remove fragment
        url.hash = '';

        return url.toString();
    } catch {
        return null;
    }
}

/**
 * Normalize a domain string to a bare domain.
 *  "HTTPS://WWW.Example.COM/page?q=1" → "example.com"
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeDomain(raw) {
    if (!raw) return '';
    let domain = raw.trim().toLowerCase();
    // Strip protocol
    domain = domain.replace(/^https?:\/\//, '');
    // Strip www
    domain = domain.replace(/^www\./, '');
    // Strip path, query, hash
    domain = domain.replace(/[/?#].*$/, '');
    return domain;
}

/**
 * Extract the domain from a URL string.
 * @param {string} urlStr
 * @returns {string|null}
 */
function extractDomain(urlStr) {
    try {
        return normalizeDomain(new URL(urlStr).hostname);
    } catch {
        return normalizeDomain(urlStr);
    }
}

module.exports = { normalizeUrl, normalizeDomain, extractDomain };
