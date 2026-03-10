require('dotenv').config();

module.exports = {
    // ─── Database ───
    db: {
        connectionString: process.env.DATABASE_URL,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'seo_automation',
        user: process.env.DB_USER || 'seo_user',
        password: process.env.DB_PASSWORD || 'seo_pass',
        max: 20,
        idleTimeoutMillis: 30000,
    },

    // ─── Redis ───
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null, // required by BullMQ
    },

    // ─── API Keys ───
    apis: {
        serper: { key: process.env.SERPER_API_KEY, dailyLimit: parseInt(process.env.SERPER_DAILY_LIMIT || '2500') },
        googleCse: {
            key: process.env.GOOGLE_CSE_API_KEY,
            cx: process.env.GOOGLE_CSE_CX,
            dailyLimit: 100,
        },
        hunter: { key: process.env.HUNTER_API_KEY, dailyLimit: 1 },
        snov: { key: process.env.SNOV_API_KEY, dailyLimit: 2 },
        skrapp: { key: process.env.SKRAPP_API_KEY, dailyLimit: 3 },
        openPageRank: { key: process.env.OPENPAGERANK_API_KEY, dailyLimit: 33000 },
    },

    // ─── Server ───
    server: {
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || '0.0.0.0',
    },

    // ─── Crawl Rate Limits ───
    rateLimits: {
        default: {
            minDelayMs: 2000,
            maxDelayMs: 15000,
            maxConcurrentPerHost: 1,
            maxRequestsPerMinute: 10,
        },
        global: {
            maxConcurrentTotal: 5,
            maxRequestsPerMinute: 30,
        },
    },

    // ─── Alert Webhook ───
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || null,

    // ─── Logging ───
    logLevel: process.env.LOG_LEVEL || 'info',
};
