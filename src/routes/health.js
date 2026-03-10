const db = require('../db');
const { getAllQueueStats } = require('../queue');

/**
 * Register health and monitoring API routes.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} deps - { queues, rateLimiter }
 */
async function healthRoutes(fastify, deps) {
    const { queues, rateLimiter } = deps;

    // ─── Health Check ───
    fastify.get('/health', async () => {
        const dbOk = await db.checkConnection();
        let redisOk = false;
        try {
            await rateLimiter.redis.ping();
            redisOk = true;
        } catch { /* redis down */ }

        return {
            status: dbOk && redisOk ? 'ok' : 'degraded',
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            services: {
                database: dbOk ? 'connected' : 'disconnected',
                redis: redisOk ? 'connected' : 'disconnected',
            },
        };
    });

    // ─── Queue Stats ───
    fastify.get('/stats/queues', async () => {
        return await getAllQueueStats(queues);
    });

    // ─── API Quota Status ───
    fastify.get('/stats/quotas', async () => {
        const services = ['serper.dev', 'google-cse', 'api.hunter.io', 'api.snov.io', 'openpagerank.com'];
        const quotas = {};

        for (const service of services) {
            quotas[service] = {
                usedToday: await rateLimiter.getQuotaUsage(service),
            };
        }

        return quotas;
    });

    // ─── Pipeline Overview ───
    fastify.get('/stats/pipeline', async (req) => {
        const campaignId = req.query.campaignId;

        let wc = '';
        const params = [];
        if (campaignId) {
            wc = 'WHERE campaign_id = $1';
            params.push(campaignId);
        }

        const oppSql = campaignId
            ? 'SELECT COUNT(*) as count, status FROM opportunities WHERE campaign_id = $1 GROUP BY status'
            : 'SELECT COUNT(*) as count, status FROM opportunities GROUP BY status';

        const [domains, backlinks, opportunities, contacts, brokenLinks] = await Promise.all([
            db.query(`SELECT COUNT(*) as count FROM domains ${wc}`, params),
            db.query(`SELECT COUNT(*) as count FROM backlinks ${wc}`, params),
            db.query(oppSql, params),
            db.query(`SELECT COUNT(*) as count FROM contacts ${wc}`, params),
            db.query(`SELECT COUNT(*) as count FROM broken_links ${wc}`, params),
        ]);

        return {
            totalDomains: parseInt(domains.rows[0]?.count || 0),
            totalBacklinks: parseInt(backlinks.rows[0]?.count || 0),
            opportunities: opportunities.rows.reduce((acc, r) => {
                acc[r.status] = parseInt(r.count);
                return acc;
            }, {}),
            totalContacts: parseInt(contacts.rows[0]?.count || 0),
            totalBrokenLinks: parseInt(brokenLinks.rows[0]?.count || 0),
        };
    });

    // ─── Recent Metrics ───
    fastify.get('/stats/metrics', async (req) => {
        const limit = Math.min(parseInt(req.query.limit || '50'), 200);
        const { rows } = await db.query(
            `SELECT metric_name, metric_value, labels, recorded_at
       FROM system_metrics ORDER BY recorded_at DESC LIMIT $1`,
            [limit]
        );
        return rows;
    });
}

module.exports = healthRoutes;
