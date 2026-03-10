const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');
const axios = require('axios');
const config = require('../config');
const { getBlacklistMultiplier } = require('../utils/blacklist');

const log = createLogger('worker:domain-analyzer');

/**
 * Domain Analyzer Worker
 *
 * Input job data: { domain }
 *
 * Calculates a quality score using multiple free signals:
 *   1. OpenPageRank API (10M/month free)
 *   2. Tranco top-1M list (free download)
 *   3. WHOIS domain age (free CLI / DomScan API)
 *   4. Referring domain count (from our DB)
 *
 * Score = weighted combination of all signals
 */
function startDomainAnalyzerWorker(deps = {}) {
    const { rateLimiter, queues } = deps;

    return createWorker(QUEUE_NAMES.DOMAIN_ANALYSIS, async (job) => {
        const { domain, campaignId } = job.data;
        if (!domain) throw new Error('Job requires domain');

        const normalized = normalizeDomain(domain);
        log.info({ domain: normalized }, 'analyzing domain');

        const signals = {};

        // ─── Signal 1: OpenPageRank ───
        try {
            signals.pageRank = await fetchOpenPageRank(normalized, rateLimiter);
        } catch (err) {
            log.debug({ err: err.message, domain: normalized }, 'OpenPageRank failed');
            signals.pageRank = null;
        }

        // ─── Signal 2: Tranco rank (from cached DB or API) ───
        try {
            signals.trancoRank = await fetchTrancoRank(normalized);
        } catch (err) {
            log.debug({ err: err.message, domain: normalized }, 'Tranco lookup failed');
            signals.trancoRank = null;
        }

        // ─── Signal 3: Referring domain count (from our backlinks table) ───
        try {
            const { rows } = await db.query(
                `SELECT COUNT(DISTINCT from_domain) as ref_count FROM backlinks WHERE to_domain = $1`,
                [normalized]
            );
            signals.referringDomains = parseInt(rows[0]?.ref_count || '0');
        } catch {
            signals.referringDomains = 0;
        }

        // ─── Signal 4: WHOIS domain age ───
        try {
            signals.domainAgeDays = await fetchDomainAge(normalized);
        } catch (err) {
            log.debug({ err: err.message, domain: normalized }, 'WHOIS age failed');
            signals.domainAgeDays = null;
        }

        // ─── Calculate composite score ───
        let score = calculateScore(signals);

        // Apply tiered blacklist penalty
        const multiplier = getBlacklistMultiplier(normalized);
        score = Math.round(score * multiplier);
        if (multiplier < 1.0) {
            log.info({ domain: normalized, originalScore: score / multiplier, newScore: score, multiplier }, 'applied blacklist penalty');
        }

        // ─── Update DB ───
        await db.query(
            `INSERT INTO domains (domain, normalized, page_rank, tranco_rank, whois_age_days, quality_score, campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (normalized, campaign_id) DO UPDATE SET
         page_rank = EXCLUDED.page_rank,
         tranco_rank = EXCLUDED.tranco_rank,
         whois_age_days = EXCLUDED.whois_age_days,
         quality_score = EXCLUDED.quality_score,
         last_updated = NOW()`,
            [normalized, normalized, signals.pageRank, signals.trancoRank, signals.domainAgeDays, score, campaignId]
        );

        await db.recordMetric('domains_analyzed', 1, { domain: normalized, score }, campaignId);

        // ─── Calculate Intersect Count & Get Best Page URL ───
        let intersectCount = 0;
        let bestPageUrl = `https://${normalized}`;
        try {
            // Get intersect count and the most relevant from_url 
            const { rows } = await db.query(
                `SELECT to_domain, from_url FROM backlinks 
                 WHERE from_domain = $1 AND campaign_id = $2 
                 AND to_domain IN (SELECT normalized FROM domains WHERE is_competitor = TRUE AND campaign_id = $2)`,
                [normalized, campaignId]
            );

            if (rows.length > 0) {
                // Count unique competitors
                const uniqueCompetitors = new Set(rows.map(r => r.to_domain));
                intersectCount = uniqueCompetitors.size;

                // Use the first valid URL we found that isn't just the domain root
                const validUrls = rows.map(r => r.from_url).filter(Boolean);
                if (validUrls.length > 0) {
                    bestPageUrl = validUrls[0];
                }
            }
        } catch (err) {
            log.debug({ err: err.message, domain: normalized }, 'intersect count lookup failed');
        }

        // ─── Chain: Enqueue opportunity classifier for scored domains ───
        // Only enqueue if the domain links to AT LEAST 1 competitor
        if (score >= 20 && intersectCount >= 1 && queues && queues.OPPORTUNITY_CLASSIFIER) {
            try {
                await queues.OPPORTUNITY_CLASSIFIER.add(
                    'classify',
                    { domain: normalized, pageUrl: bestPageUrl, campaignId, intersectCount },
                    { jobId: `classify-${campaignId}-${normalized}` }
                );
                log.debug({ domain: normalized, score }, 'enqueued for classification');
            } catch { /* already enqueued */ }
        }

        log.info({ domain: normalized, score, signals }, 'domain analysis complete');
        return { domain: normalized, score, signals };
    }, { concurrency: 3 });
}

/**
 * Fetch domain authority from OpenPageRank API.
 * Free: 10M lookups/month
 */
async function fetchOpenPageRank(domain, rateLimiter) {
    if (!config.apis.openPageRank.key) return null;

    if (rateLimiter) {
        const hasQuota = await rateLimiter.checkQuota('openpagerank.com', config.apis.openPageRank.dailyLimit);
        if (!hasQuota) return null;
    }

    const { data } = await axios.get('https://openpagerank.com/api/v1.0/getPageRank', {
        params: { domains: [domain] },
        headers: { 'API-OPR': config.apis.openPageRank.key },
        timeout: 8000,
    });

    const result = data?.response?.[0];
    return result?.page_rank_decimal ?? null;
}

/**
 * Fetch Tranco rank for a domain.
 * The Tranco list is a free, research-grade top-1M domain ranking.
 * We check against the API endpoint.
 */
async function fetchTrancoRank(domain) {
    try {
        const { data } = await axios.get(`https://tranco-list.eu/api/ranks/domain/${domain}`, {
            timeout: 8000,
        });
        // Return the rank from the latest list
        if (data?.ranks?.length > 0) {
            return data.ranks[0].rank;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Estimate domain age using the Wayback Machine API (free).
 * Falls back to null if unavailable.
 */
async function fetchDomainAge(domain) {
    try {
        const { data } = await axios.get(
            `https://archive.org/wayback/available?url=${domain}&timestamp=19900101`,
            { timeout: 8000 }
        );

        const snapshot = data?.archived_snapshots?.closest;
        if (snapshot?.timestamp) {
            // Timestamp format: YYYYMMDDHHmmss
            const year = parseInt(snapshot.timestamp.slice(0, 4));
            const month = parseInt(snapshot.timestamp.slice(4, 6)) - 1;
            const day = parseInt(snapshot.timestamp.slice(6, 8));
            const firstSeen = new Date(year, month, day);
            const ageDays = Math.floor((Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
            return ageDays;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Composite quality score calculation.
 * Scale: 0–100
 */
function calculateScore(signals) {
    let score = 0;
    let weights = 0;

    // PageRank (0-10 scale from OPR → normalize to 0-100)
    if (signals.pageRank !== null && signals.pageRank !== undefined) {
        score += (signals.pageRank / 10) * 100 * 0.30;
        weights += 0.30;
    }

    // Tranco rank (lower = better, top 1M)
    if (signals.trancoRank !== null && signals.trancoRank !== undefined) {
        // Log scale: rank 1 = 100, rank 1M = 0
        const rankScore = Math.max(0, 100 - (Math.log10(signals.trancoRank) / 6) * 100);
        score += rankScore * 0.25;
        weights += 0.25;
    }

    // Referring domains (logarithmic scale)
    if (signals.referringDomains > 0) {
        const refScore = Math.min(100, Math.log10(signals.referringDomains + 1) * 33);
        score += refScore * 0.25;
        weights += 0.25;
    }

    // Domain age (older = more trustworthy)
    if (signals.domainAgeDays !== null && signals.domainAgeDays !== undefined) {
        // 10 years+ = full score
        const ageScore = Math.min(100, (signals.domainAgeDays / 3650) * 100);
        score += ageScore * 0.20;
        weights += 0.20;
    }

    // Normalize if not all signals available
    return weights > 0 ? Math.round((score / weights) * 10) / 10 : 0;
}

module.exports = { startDomainAnalyzerWorker, calculateScore };
