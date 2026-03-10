const { BloomFilter } = require('bloom-filters');
const crypto = require('crypto');
const { normalizeUrl, normalizeDomain } = require('./normalizer');

/**
 * Deduplication engine — 3-layer strategy:
 *  Layer 1: In-memory Bloom filter (fast probabilistic check)
 *  Layer 2: BullMQ job ID uses URL hash → auto dedup in queue
 *  Layer 3: PostgreSQL UNIQUE constraint → guaranteed at DB level
 *
 * This module handles Layer 1 (Bloom filter).
 */
class DedupEngine {
    /**
     * @param {object} options
     * @param {number} [options.expectedItems=1000000] Expected number of unique items
     * @param {number} [options.falsePositiveRate=0.01] Acceptable false positive rate
     */
    constructor(options = {}) {
        const { expectedItems = 1_000_000, falsePositiveRate = 0.01 } = options;
        this.filter = BloomFilter.create(expectedItems, falsePositiveRate);
        this.stats = { checked: 0, duplicates: 0, passed: 0 };
    }

    /**
     * Check if a URL has been seen before. If new, marks it as seen.
     * @param {string} rawUrl
     * @returns {boolean} true if the URL is new (not seen before)
     */
    isNewUrl(rawUrl) {
        const normalized = normalizeUrl(rawUrl);
        if (!normalized) return false;

        this.stats.checked++;
        if (this.filter.has(normalized)) {
            this.stats.duplicates++;
            return false;
        }
        this.filter.add(normalized);
        this.stats.passed++;
        return true;
    }

    /**
     * Check if a domain has been seen before. If new, marks it as seen.
     * @param {string} rawDomain
     * @returns {boolean} true if the domain is new
     */
    isNewDomain(rawDomain) {
        const normalized = normalizeDomain(rawDomain);
        if (!normalized) return false;

        const key = `domain:${normalized}`;
        this.stats.checked++;
        if (this.filter.has(key)) {
            this.stats.duplicates++;
            return false;
        }
        this.filter.add(key);
        this.stats.passed++;
        return true;
    }

    /**
     * Generate a deterministic hash for queue job ID dedup (Layer 2)
     * @param {string} rawUrl
     * @returns {string} SHA-256 hash
     */
    static hashUrl(rawUrl) {
        const normalized = normalizeUrl(rawUrl) || rawUrl;
        return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    }

    /**
     * Get dedup statistics
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset the filter (e.g., between crawl runs)
     */
    reset(expectedItems = 1_000_000, falsePositiveRate = 0.01) {
        this.filter = BloomFilter.create(expectedItems, falsePositiveRate);
        this.stats = { checked: 0, duplicates: 0, passed: 0 };
    }
}

module.exports = DedupEngine;
