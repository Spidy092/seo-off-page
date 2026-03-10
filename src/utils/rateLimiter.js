const { createLogger } = require('./logger');
const config = require('../config');
const Redis = require('ioredis');

const log = createLogger('rate-limiter');

/**
 * Adaptive rate limiter backed by Redis.
 *
 * - Per-host delays with exponential backoff on 429/503
 * - Per-service daily quota tracking
 * - Global concurrency control
 * - User-Agent rotation
 */
class RateLimiter {
    constructor(redisConnection) {
        this.redis = redisConnection;
        this.delays = {};          // host → current delay ms
        this.consecutiveErrors = {};
        this.activeConcurrent = 0;
        this.limits = config.rateLimits;
    }

    // ──────────────────────────────────────────────
    //  Per-host adaptive delay
    // ──────────────────────────────────────────────

    /**
     * Wait for the appropriate delay before making a request to `host`
     */
    async waitForHost(host) {
        const delay = this.delays[host] || this.limits.default.minDelayMs;
        await this._sleep(delay + this._jitter());
    }

    /**
     * Handle a response status, adjusting the host's delay.
     */
    onResponse(host, statusCode) {
        if (statusCode === 429 || statusCode === 503) {
            // exponential backoff
            const current = this.delays[host] || this.limits.default.minDelayMs;
            this.delays[host] = Math.min(current * 2, this.limits.default.maxDelayMs);
            this.consecutiveErrors[host] = (this.consecutiveErrors[host] || 0) + 1;

            if (this.consecutiveErrors[host] >= 5) {
                this.delays[host] = this.limits.default.maxDelayMs;
                log.warn({ host, pause: '10min' }, 'host paused after 5 consecutive errors');
                // Pause host for 10 minutes via elevated delay
                setTimeout(() => {
                    this.delays[host] = this.limits.default.minDelayMs;
                    this.consecutiveErrors[host] = 0;
                    log.info({ host }, 'host unpaused');
                }, 10 * 60 * 1000);
            }
        } else if (statusCode >= 200 && statusCode < 400) {
            // Gradually reduce delay
            const current = this.delays[host] || this.limits.default.minDelayMs;
            this.delays[host] = Math.max(current * 0.8, this.limits.default.minDelayMs);
            this.consecutiveErrors[host] = 0;
        }
    }

    // ──────────────────────────────────────────────
    //  Per-service daily quota tracking (Redis)
    // ──────────────────────────────────────────────

    /**
     * Check if the daily quota allows another request. Increments the counter if yes.
     * @param {string} service - Service identifier (e.g., 'serper.dev')
     * @param {number} dailyLimit - Max requests per day
     * @returns {boolean} true if within quota
     */
    async checkQuota(service, dailyLimit) {
        const today = new Date().toISOString().split('T')[0];
        const key = `quota:${service}:${today}`;

        const used = await this.redis.incr(key);
        if (used === 1) {
            await this.redis.expire(key, 86400);
        }

        if (used > dailyLimit) {
            log.warn({ service, used, dailyLimit }, 'daily quota exhausted');
            return false;
        }

        if (used > dailyLimit * 0.8) {
            log.warn({ service, used, dailyLimit }, 'daily quota > 80%');
        }

        return true;
    }

    /**
     * Get current quota usage for a service.
     */
    async getQuotaUsage(service) {
        const today = new Date().toISOString().split('T')[0];
        const key = `quota:${service}:${today}`;
        const used = parseInt(await this.redis.get(key) || '0');
        return used;
    }

    // ──────────────────────────────────────────────
    //  Global concurrency
    // ──────────────────────────────────────────────

    async acquireConcurrency() {
        while (this.activeConcurrent >= this.limits.global.maxConcurrentTotal) {
            await this._sleep(200);
        }
        this.activeConcurrent++;
    }

    releaseConcurrency() {
        this.activeConcurrent = Math.max(0, this.activeConcurrent - 1);
    }

    // ──────────────────────────────────────────────
    //  User-Agent rotation
    // ──────────────────────────────────────────────

    getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    // ──────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────

    _jitter() {
        return Math.floor(Math.random() * 1000);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const USER_AGENTS = [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
];

module.exports = RateLimiter;
