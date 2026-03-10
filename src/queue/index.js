const { Queue, Worker, QueueScheduler } = require('bullmq');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('queue');

/**
 * Queue names used throughout the system.
 */
const QUEUE_NAMES = {
    COMPETITOR_DISCOVERY: 'competitor-discovery',
    BACKLINK_EXTRACTION: 'backlink-extraction',
    DOMAIN_ANALYSIS: 'domain-analysis',
    EMAIL_FINDER: 'email-finder',
    BROKEN_LINK: 'broken-link',
    OPPORTUNITY_CLASSIFIER: 'opportunity-classifier',
    COMMON_CRAWL_INGEST: 'common-crawl-ingest',
    DIRECTORY_FINDER: 'directory-finder',
};

/**
 * Shared Redis connection config for all queues.
 */
const connectionConfig = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
};

/**
 * Create a BullMQ queue with standard defaults.
 * @param {string} name - Queue name
 * @param {object} [opts] - Additional queue options
 * @returns {Queue}
 */
function createQueue(name, opts = {}) {
    const queue = new Queue(name, {
        connection: connectionConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 86400, count: 1000 }, // Keep 1000 or 24h
            removeOnFail: { age: 7 * 86400, count: 5000 }, // Keep failed for 7 days
            ...opts.defaultJobOptions,
        },
        ...opts,
    });

    queue.on('error', (err) => log.error({ queue: name, err }, 'queue error'));

    log.info({ queue: name }, 'queue created');
    return queue;
}

/**
 * Create a BullMQ worker with standard error handling.
 * @param {string} queueName - Queue name to process
 * @param {Function} processor - Job processing function(job)
 * @param {object} [opts] - Worker options
 * @returns {Worker}
 */
function createWorker(queueName, processor, opts = {}) {
    const worker = new Worker(queueName, processor, {
        connection: connectionConfig,
        concurrency: opts.concurrency || 1,
        limiter: opts.limiter,
        ...opts,
    });

    worker.on('completed', (job) => {
        log.info({ queue: queueName, jobId: job.id }, 'job completed');
    });

    worker.on('failed', (job, err) => {
        log.error({ queue: queueName, jobId: job?.id, err: err.message }, 'job failed');
    });

    worker.on('error', (err) => {
        log.error({ queue: queueName, err }, 'worker error');
    });

    log.info({ queue: queueName, concurrency: opts.concurrency || 1 }, 'worker started');
    return worker;
}

/**
 * Create all application queues.
 * @returns {Object} Map of queue name → Queue instance
 */
function initializeQueues() {
    const queues = {};

    for (const [key, name] of Object.entries(QUEUE_NAMES)) {
        queues[key] = createQueue(name);
    }

    log.info({ count: Object.keys(queues).length }, 'all queues initialized');
    return queues;
}

/**
 * Get job counts for all queues (for health endpoint).
 */
async function getAllQueueStats(queues) {
    const stats = {};
    for (const [key, queue] of Object.entries(queues)) {
        stats[key] = await queue.getJobCounts(
            'active', 'completed', 'delayed', 'failed', 'waiting'
        );
    }
    return stats;
}

module.exports = {
    QUEUE_NAMES,
    connectionConfig,
    createQueue,
    createWorker,
    initializeQueues,
    getAllQueueStats,
};
