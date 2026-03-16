/**
 * 🔍 Enhanced Competitor Discovery & Analysis Worker
 * 
 * Discovers competitors AND performs deep analysis on each one.
 * Generates actionable insights and recommendations.
 */

const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { search } = require('../services/serp');
const { normalizeDomain } = require('../utils/normalizer');
const { getBlacklistMultiplier } = require('../utils/blacklist');
const competitorAnalyzer = require('../services/competitorAnalyzer');
const db = require('../db');

const log = createLogger('worker:competitor-enhanced');

// ─── Bad Competitor Filter ───
const isBadCompetitor = (domain) => {
    const blacklist = [
        'wikipedia.org', 'amazon.', 'etsy.com', 'ebay.',
        'youtube.com', 'facebook.com', 'twitter.com', 'linkedin.com',
        'instagram.com', 'pinterest.com', 'reddit.com', 'quora.com',
        'medium.com', 'wordpress.com', 'blogspot.com',
    ];
    
    if (getBlacklistMultiplier(domain) === 0.0) return true;
    if (blacklist.some(bad => domain.includes(bad))) return true;
    return false;
};

// ─── Competitor Discovery ───
async function discoverCompetitors(targetDomain, keywords, rateLimiter) {
    const competitorSet = new Set();
    const normalizedTarget = normalizeDomain(targetDomain);

    for (const keyword of keywords) {
        try {
            // 1. Search the raw keyword
            const rawResults = await search(keyword, 10, { rateLimiter });

            // 2. SERP Footprint Mining
            const footprintResults = await search(
                `${keyword} intitle:resources OR inurl:links`, 
                10, 
                { rateLimiter }
            );

            // 3. Competitor-specific searches
            const competitorResults = await search(
                `${keyword} "top" OR "best" OR "review"`,
                10,
                { rateLimiter }
            );

            const combinedResults = [...rawResults, ...footprintResults, ...competitorResults];

            for (const result of combinedResults) {
                const domain = normalizeDomain(result.url);
                if (domain && 
                    domain !== normalizedTarget && 
                    !isBadCompetitor(domain) && 
                    !competitorSet.has(domain)) {
                    competitorSet.add(domain);
                }
            }

            // Rate limit between searches
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            log.error({ keyword, err: err.message }, 'keyword search failed');
        }
    }

    return [...competitorSet];
}

// ─── Main Worker ───
function startEnhancedCompetitorWorker(deps = {}) {
    const { rateLimiter, queues } = deps;

    return createWorker(QUEUE_NAMES.COMPETITOR_DISCOVERY, async (job) => {
        const { targetDomain, keywords, campaignId, options = {} } = job.data;

        if (!targetDomain || !keywords?.length) {
            throw new Error('Job requires targetDomain and keywords[]');
        }

        const {
            maxCompetitors = 10,
            deepAnalysis = true,
            includeKeywordGaps = true,
        } = options;

        log.info({ 
            targetDomain, 
            keywordCount: keywords.length,
            maxCompetitors,
            deepAnalysis,
        }, '🚀 starting enhanced competitor discovery');

        // ─── Phase 1: Discover Competitors ───
        await job.updateProgress(10);
        log.info('Phase 1: Discovering competitors...');
        
        const allCompetitors = await discoverCompetitors(targetDomain, keywords, rateLimiter);
        const competitors = allCompetitors.slice(0, maxCompetitors);

        log.info({ 
            found: allCompetitors.length, 
            analyzing: competitors.length 
        }, 'competitors discovered');

        // Store basic competitor info
        for (const competitor of competitors) {
            try {
                await db.query(
                    `INSERT INTO domains (domain, normalized, is_competitor, campaign_id)
                     VALUES ($1, $2, TRUE, $3)
                     ON CONFLICT (normalized, campaign_id) DO UPDATE SET 
                         is_competitor = TRUE, 
                         last_updated = NOW()`,
                    [competitor, competitor, campaignId]
                );
            } catch (err) {
                log.error({ err: err.message, domain: competitor }, 'failed to store competitor');
            }
        }

        // ─── Phase 2: Deep Analysis ───
        let analysisResults = null;
        
        if (deepAnalysis) {
            await job.updateProgress(30);
            log.info('Phase 2: Running deep competitor analysis...');
            
            try {
                analysisResults = await competitorAnalyzer.analyzeCompetitors(
                    targetDomain,
                    competitors,
                    keywords
                );

                // Store analysis results
                await db.query(
                    `INSERT INTO competitor_analyses 
                     (campaign_id, target_domain, analysis_data, created_at)
                     VALUES ($1, $2, $3, NOW())`,
                    [campaignId, targetDomain, JSON.stringify(analysisResults)]
                );

                log.info({
                    analyzed: analysisResults.totalCompetitors,
                    avgScore: analysisResults.summary?.averageCompetitorScore,
                    highThreats: analysisResults.summary?.threatDistribution?.high,
                    opportunities: analysisResults.summary?.totalOpportunities,
                }, 'deep analysis complete');

            } catch (err) {
                log.error({ err: err.message }, 'deep analysis failed');
            }
        }

        // ─── Phase 3: Enqueue Follow-up Jobs ───
        await job.updateProgress(80);
        log.info('Phase 3: Enqueueing follow-up jobs...');

        for (const competitor of competitors) {
            try {
                // Backlink extraction
                if (queues && queues.BACKLINK_EXTRACTION) {
                    await queues.BACKLINK_EXTRACTION.add(
                        'extract',
                        { 
                            domain: competitor, 
                            targetDomain: normalizeDomain(targetDomain), 
                            campaignId,
                            priority: analysisResults?.competitors?.find(c => c.competitor === competitor)?.score?.threatLevel === 'HIGH' ? 'high' : 'normal',
                        },
                        { 
                            jobId: `backlink-${campaignId}-${competitor}-${Date.now()}`,
                            priority: analysisResults?.competitors?.find(c => c.competitor === competitor)?.score?.threatLevel === 'HIGH' ? 1 : 2,
                        }
                    );
                }
            } catch (err) {
                log.error({ err: err.message, domain: competitor }, 'failed to enqueue backlink job');
            }
        }

        await job.updateProgress(100);

        // ─── Record Metrics ───
        await db.recordMetric('competitors_discovered', competitors.length, { target: targetDomain }, campaignId);
        if (analysisResults) {
            await db.recordMetric('competitors_analyzed', analysisResults.totalCompetitors, { target: targetDomain }, campaignId);
            await db.recordMetric('keyword_opportunities', analysisResults.summary?.totalOpportunities || 0, { target: targetDomain }, campaignId);
        }

        // ─── Return Results ───
        const result = {
            targetDomain,
            campaignId,
            phase1_discovery: {
                totalFound: allCompetitors.length,
                selected: competitors.length,
                competitors,
            },
            phase2_analysis: analysisResults ? {
                totalAnalyzed: analysisResults.totalCompetitors,
                averageScore: analysisResults.summary?.averageCompetitorScore,
                threatDistribution: analysisResults.summary?.threatDistribution,
                topThreats: analysisResults.summary?.topThreats,
                keywordOpportunities: analysisResults.summary?.totalOpportunities,
                topRecommendations: analysisResults.summary?.topRecommendations?.slice(0, 5),
            } : null,
            phase3_followUp: {
                backlinkJobsEnqueued: competitors.length,
            },
        };

        log.info(result, '✅ enhanced competitor analysis complete');
        return result;

    }, { concurrency: 1 });
}

module.exports = { startEnhancedCompetitorWorker };
