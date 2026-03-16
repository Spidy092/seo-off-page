/**
 * 📊 Competitor Analysis API Routes
 * 
 * Endpoints for triggering and retrieving competitor analysis.
 */

const db = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:competitor');

async function competitorRoutes(fastify, options) {
    const { queues } = options;

    // ─── Start Competitor Analysis ───
    fastify.post('/api/competitors/analyze', {
        schema: {
            body: {
                type: 'object',
                required: ['targetDomain', 'keywords'],
                properties: {
                    targetDomain: { type: 'string' },
                    keywords: { 
                        type: 'array', 
                        items: { type: 'string' },
                        minItems: 1,
                        maxItems: 20,
                    },
                    campaignId: { type: 'string' },
                    options: {
                        type: 'object',
                        properties: {
                            maxCompetitors: { type: 'number', default: 10 },
                            deepAnalysis: { type: 'boolean', default: true },
                            includeKeywordGaps: { type: 'boolean', default: true },
                        },
                    },
                },
            },
        },
        handler: async (request, reply) => {
            const { targetDomain, keywords, campaignId, options } = request.body;
            const jobId = `competitor-${campaignId || Date.now()}-${Date.now()}`;

            try {
                const job = await queues.COMPETITOR_DISCOVERY.add(
                    'analyze',
                    { 
                        targetDomain, 
                        keywords, 
                        campaignId: campaignId || jobId,
                        options: {
                            maxCompetitors: options?.maxCompetitors || 10,
                            deepAnalysis: options?.deepAnalysis !== false,
                            includeKeywordGaps: options?.includeKeywordGaps !== false,
                        },
                    },
                    { jobId }
                );

                return {
                    success: true,
                    message: 'Competitor analysis started',
                    jobId: job.id,
                    statusUrl: `/api/competitors/status/${job.id}`,
                };
            } catch (err) {
                log.error({ err: err.message }, 'failed to start competitor analysis');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Analysis Status ───
    fastify.get('/api/competitors/status/:jobId', async (request, reply) => {
        const { jobId } = request.params;

        try {
            const job = await queues.COMPETITOR_DISCOVERY.getJob(jobId);
            
            if (!job) {
                return reply.code(404).send({ error: 'Job not found' });
            }

            const state = await job.getState();
            const progress = job.progress;
            const result = job.returnvalue;
            const failedReason = job.failedReason;

            return {
                jobId: job.id,
                state,
                progress,
                result,
                error: failedReason,
                createdAt: new Date(job.timestamp).toISOString(),
                processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get job status');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Stored Analysis ───
    fastify.get('/api/competitors/analysis/:campaignId', async (request, reply) => {
        const { campaignId } = request.params;

        try {
            const result = await db.query(
                `SELECT * FROM competitor_analyses 
                 WHERE campaign_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT 1`,
                [campaignId]
            );

            if (result.rows.length === 0) {
                return reply.code(404).send({ error: 'Analysis not found' });
            }

            return {
                campaignId,
                analysis: result.rows[0].analysis_data,
                createdAt: result.rows[0].created_at,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get analysis');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Competitor List ───
    fastify.get('/api/competitors/list/:campaignId', async (request, reply) => {
        const { campaignId } = request.params;
        const { limit = 50, offset = 0 } = request.query;

        try {
            const result = await db.query(
                `SELECT domain, normalized, created_at, last_updated
                 FROM domains 
                 WHERE campaign_id = $1 AND is_competitor = TRUE
                 ORDER BY created_at DESC
                 LIMIT $2 OFFSET $3`,
                [campaignId, limit, offset]
            );

            const countResult = await db.query(
                `SELECT COUNT(*) as total 
                 FROM domains 
                 WHERE campaign_id = $1 AND is_competitor = TRUE`,
                [campaignId]
            );

            return {
                campaignId,
                total: parseInt(countResult.rows[0].total),
                competitors: result.rows,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get competitor list');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Quick Competitor Score ───
    fastify.post('/api/competitors/score', {
        schema: {
            body: {
                type: 'object',
                required: ['domain'],
                properties: {
                    domain: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { domain } = request.body;

            try {
                const competitorAnalyzer = require('../services/competitorAnalyzer');
                
                const [domainAuthority, traffic, contentStrategy, socialPresence] = await Promise.all([
                    competitorAnalyzer.estimateDomainAuthority(domain),
                    competitorAnalyzer.estimateTraffic(domain),
                    competitorAnalyzer.analyzeContentStrategy(domain),
                    competitorAnalyzer.analyzeSocialPresence(domain),
                ]);

                const analysis = { domainAuthority, traffic, contentStrategy, socialPresence };
                
                // Calculate quick score
                const score = {
                    domainAuthority: domainAuthority.daScore || 0,
                    traffic: Math.min(100, (traffic.estimatedMonthlyVisits || 0) / 1000),
                    contentQuality: (contentStrategy.hasBlog ? 25 : 0) +
                                   (contentStrategy.hasResources ? 25 : 0) +
                                   (contentStrategy.topics?.length || 0) * 2.5,
                    socialPresence: Object.values(socialPresence).filter(s => s.found).length * 20,
                };

                const totalScore = Math.round(
                    score.domainAuthority * 0.3 +
                    score.traffic * 0.25 +
                    score.contentQuality * 0.25 +
                    score.socialPresence * 0.2
                );

                let threatLevel;
                if (totalScore >= 70) threatLevel = 'HIGH';
                else if (totalScore >= 40) threatLevel = 'MEDIUM';
                else threatLevel = 'LOW';

                return {
                    domain,
                    score: totalScore,
                    threatLevel,
                    breakdown: score,
                    details: {
                        domainAge: domainAuthority.signals?.domainAge,
                        indexedPages: traffic.indexedPages,
                        hasBlog: contentStrategy.hasBlog,
                        topics: contentStrategy.topics?.slice(0, 10),
                        socialPlatforms: Object.entries(socialPresence)
                            .filter(([_, v]) => v.found)
                            .map(([k]) => k),
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'failed to score competitor');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Compare Competitors ───
    fastify.post('/api/competitors/compare', {
        schema: {
            body: {
                type: 'object',
                required: ['domains'],
                properties: {
                    domains: { 
                        type: 'array', 
                        items: { type: 'string' },
                        minItems: 2,
                        maxItems: 5,
                    },
                },
            },
        },
        handler: async (request, reply) => {
            const { domains } = request.body;

            try {
                const competitorAnalyzer = require('../services/competitorAnalyzer');
                const results = [];

                for (const domain of domains) {
                    const [domainAuthority, traffic, contentStrategy, socialPresence] = await Promise.all([
                        competitorAnalyzer.estimateDomainAuthority(domain),
                        competitorAnalyzer.estimateTraffic(domain),
                        competitorAnalyzer.analyzeContentStrategy(domain),
                        competitorAnalyzer.analyzeSocialPresence(domain),
                    ]);

                    results.push({
                        domain,
                        da: domainAuthority.daScore || 0,
                        traffic: traffic.estimatedMonthlyVisits || 0,
                        hasBlog: contentStrategy.hasBlog,
                        topics: contentStrategy.topics?.slice(0, 5) || [],
                        socialCount: Object.values(socialPresence).filter(s => s.found).length,
                    });

                    await new Promise(r => setTimeout(r, 2000)); // Rate limit
                }

                // Sort by DA
                results.sort((a, b) => b.da - a.da);

                return {
                    comparison: results,
                    winner: results[0],
                    insights: {
                        highestDA: results[0],
                        mostTraffic: results.reduce((a, b) => a.traffic > b.traffic ? a : b),
                        mostSocial: results.reduce((a, b) => a.socialCount > b.socialCount ? a : b),
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'failed to compare competitors');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Recommendations ───
    fastify.get('/api/competitors/recommendations/:campaignId', async (request, reply) => {
        const { campaignId } = request.params;

        try {
            const result = await db.query(
                `SELECT analysis_data 
                 FROM competitor_analyses 
                 WHERE campaign_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT 1`,
                [campaignId]
            );

            if (result.rows.length === 0) {
                return reply.code(404).send({ error: 'Analysis not found' });
            }

            const analysis = result.rows[0].analysis_data;
            const recommendations = analysis.summary?.topRecommendations || [];
            const keywordOpportunities = analysis.summary?.keywordOpportunities || [];

            return {
                campaignId,
                recommendations: {
                    highPriority: recommendations.filter(r => r.priority === 'HIGH'),
                    mediumPriority: recommendations.filter(r => r.priority === 'MEDIUM'),
                    lowPriority: recommendations.filter(r => r.priority === 'LOW'),
                },
                keywordOpportunities: {
                    easy: keywordOpportunities.filter(k => k.difficulty === 'easy'),
                    medium: keywordOpportunities.filter(k => k.difficulty === 'medium'),
                    hard: keywordOpportunities.filter(k => k.difficulty === 'hard'),
                },
                summary: {
                    totalRecommendations: recommendations.length,
                    totalKeywordOpportunities: keywordOpportunities.length,
                    topThreats: analysis.summary?.topThreats || [],
                },
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get recommendations');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = competitorRoutes;
