require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fastify = require('fastify')({ logger: false });
const cors = require('@fastify/cors');
const Redis = require('ioredis');

const config = require('./src/config');
const { logger, createLogger } = require('./src/utils/logger');
const db = require('./src/db');
const { initializeQueues } = require('./src/queue');
const RateLimiter = require('./src/utils/rateLimiter');

// Routes
const healthRoutes = require('./src/routes/health');
const automationRoutes = require('./src/routes/automation');

// Workers
const { startCompetitorWorker } = require('./src/workers/competitorWorker');
const { startBacklinkWorker } = require('./src/workers/backlinkWorker');
const { startDomainAnalyzerWorker } = require('./src/workers/domainAnalyzerWorker');
const { startEmailFinderWorker } = require('./src/workers/emailFinderWorker');
const { startBrokenLinkWorker } = require('./src/workers/brokenLinkWorker');
const { startOpportunityClassifierWorker } = require('./src/workers/opportunityClassifierWorker');

const log = createLogger('server');

async function main() {
    log.info('🚀 Starting Off-Page SEO Automation Engine...');

    // ─── 1. Database ───
    try {
        await db.initializeDatabase();
        log.info('✅ Database initialized');
    } catch (err) {
        log.error({ err }, '❌ Database initialization failed');
        log.info('💡 Make sure PostgreSQL is running and the database exists.');
        log.info('   Run: createdb seo_automation');
        process.exit(1);
    }

    // ─── 2. Redis ───
    let redis;
    try {
        redis = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            maxRetriesPerRequest: null,
            lazyConnect: true,
        });
        await redis.connect();
        log.info('✅ Redis connected');
    } catch (err) {
        log.error({ err }, '❌ Redis connection failed');
        log.info('💡 Make sure Redis is running: redis-server');
        process.exit(1);
    }

    // ─── 3. Rate Limiter ───
    const rateLimiter = new RateLimiter(redis);
    log.info('✅ Rate limiter initialized');

    // ─── 4. Queues ───
    const queues = initializeQueues();
    log.info('✅ Queues initialized');

    // ─── 5. Workers ───
    const deps = { rateLimiter, queues };

    const workers = [
        startCompetitorWorker(deps),
        startBacklinkWorker(deps),
        startDomainAnalyzerWorker(deps),
        startEmailFinderWorker(deps),
        startBrokenLinkWorker(deps),
        startOpportunityClassifierWorker(deps),
    ];
    log.info({ count: workers.length }, '✅ Workers started');

    // ─── 6. Fastify Server ───
    await fastify.register(cors, { origin: true });

    // Content type parser for JSON
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
        try {
            var json = JSON.parse(body)
            done(null, json)
        } catch (err) {
            err.statusCode = 400
            done(err, undefined)
        }
    });

    // Serve dashboard HTML at root
    const dashboardPath = path.join(__dirname, 'src', 'public', 'dashboard.html');
    fastify.get('/', async (req, reply) => {
        const html = fs.readFileSync(dashboardPath, 'utf8');
        reply.type('text/html').send(html);
    });

    // Register API routes
    await fastify.register(async (instance) => {
        await healthRoutes(instance, { queues, rateLimiter });
        await automationRoutes(instance, { queues });
    });

    await fastify.listen({ port: config.server.port, host: config.server.host });

    log.info(`✅ Server listening on http://${config.server.host}:${config.server.port}`);
    log.info('');
    log.info('═══════════════════════════════════════════');
    log.info(' Off-Page SEO Automation Engine is READY');
    log.info('═══════════════════════════════════════════');
    log.info('');
    log.info('API Endpoints:');
    log.info(`  POST http://localhost:${config.server.port}/api/pipeline/start`);
    log.info(`  GET  http://localhost:${config.server.port}/health`);
    log.info(`  GET  http://localhost:${config.server.port}/stats/pipeline`);
    log.info(`  GET  http://localhost:${config.server.port}/stats/queues`);
    log.info(`  GET  http://localhost:${config.server.port}/stats/quotas`);
    log.info(`  GET  http://localhost:${config.server.port}/api/opportunities`);
    log.info(`  GET  http://localhost:${config.server.port}/api/domains`);
    log.info('');

    // ─── Graceful Shutdown ───
    const shutdown = async (signal) => {
        log.info({ signal }, 'shutting down...');

        // Close workers
        await Promise.allSettled(workers.map(w => w.close()));

        // Close queues
        await Promise.allSettled(Object.values(queues).map(q => q.close()));

        // Close server
        await fastify.close();

        // Close Redis
        await redis.quit();

        // Close DB pool
        await db.pool.end();

        log.info('shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    logger.error({ err }, 'fatal startup error');
    process.exit(1);
});
