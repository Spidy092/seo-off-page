const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { search } = require('../services/serp');
const { normalizeDomain } = require('../utils/normalizer');
const { getBlacklistMultiplier } = require('../utils/blacklist');
const db = require('../db');

const log = createLogger('worker:competitor');

/**
 * Competitor Discovery Worker
 *
 * Input job data: { targetDomain, keywords[] }
 *
 * Process:
 *  1. For each keyword, search using multi-source SERP
 *  2. Extract domains from results
 *  3. Filter out the target domain itself
 *  4. Store competitors in DB
 *  5. Enqueue backlink extraction jobs for each competitor
 */
function startCompetitorWorker(deps = {}) {
    const { rateLimiter, queues } = deps;

    return createWorker(QUEUE_NAMES.COMPETITOR_DISCOVERY, async (job) => {
        const { targetDomain, keywords, campaignId } = job.data;

        if (!targetDomain || !keywords?.length) {
            throw new Error('Job requires targetDomain and keywords[]');
        }

        log.info({ targetDomain, keywordCount: keywords.length }, 'starting competitor discovery');

        const competitorSet = new Set();
        const normalizedTarget = normalizeDomain(targetDomain);

        // Bad competitor filter: we drop Tier 1 (social/junk) and Wikipedia entirely
        const isBadCompetitor = (domain) => {
            if (getBlacklistMultiplier(domain) === 0.0) return true;
            if (domain.includes('wikipedia.org') || domain.includes('amazon.') || domain.includes('etsy.com') || domain.includes('ebay.')) return true;
            return false;
        };

        for (const keyword of keywords) {
            // 1. Search the raw keyword
            const rawResults = await search(keyword, 10, { rateLimiter });

            // 2. SERP Footprint Mining (search for resources/links specifically)
            const footprintResults = await search(`${keyword} intitle:resources OR inurl:links`, 10, { rateLimiter });

            const combinedResults = [...rawResults, ...footprintResults];

            for (const result of combinedResults) {
                const domain = normalizeDomain(result.url);
                if (domain && domain !== normalizedTarget && !isBadCompetitor(domain) && !competitorSet.has(domain)) {
                    competitorSet.add(domain);
                }
            }

            // Brief delay between keyword searches
            await new Promise(r => setTimeout(r, 1500));
        }

        log.info({ targetDomain, competitors: competitorSet.size }, 'competitors found');

        // Store competitors in DB
        for (const competitor of competitorSet) {
            try {
                await db.query(
                    `INSERT INTO domains (domain, normalized, is_competitor, campaign_id)
                     VALUES ($1, $2, TRUE, $3)
                     ON CONFLICT (normalized, campaign_id) DO UPDATE SET is_competitor = TRUE, last_updated = NOW()`,
                    [competitor, competitor, campaignId]
                );

                // Enqueue backlink extraction for this competitor
                if (queues && queues.BACKLINK_EXTRACTION) {
                    await queues.BACKLINK_EXTRACTION.add(
                        'extract',
                        { domain: competitor, targetDomain: normalizedTarget, campaignId },
                        { jobId: `backlink-${campaignId}-${competitor}-${Date.now()}` }
                    );
                }
            } catch (err) {
                log.error({ err: err.message, domain: competitor }, 'failed to store competitor');
            }
        }

        await db.recordMetric('competitors_discovered', competitorSet.size, { target: targetDomain }, campaignId);

        return { targetDomain, campaignId, competitorsFound: competitorSet.size, competitors: [...competitorSet] };
    }, { concurrency: 1 });
}

module.exports = { startCompetitorWorker };
