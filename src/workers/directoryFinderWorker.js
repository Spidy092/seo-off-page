const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');
const axios = require('axios');
const config = require('../config');
const { search } = require('../services/serp');
const path = require('path');

const log = createLogger('worker:directory-finder');

// Load seed data
const directories = require('../data/directories.json');
const bookmarking = require('../data/bookmarking.json');
const footprints = require('../data/directoryFootprints.json');

/**
 * Directory Finder Worker
 *
 * 3-Layer Discovery System:
 *   Layer 1: Curated seed lists (always active, free)
 *   Layer 2: Directory footprint crawling (always active, free)
 *   Layer 3: SERP footprint mining (hybrid mode only, costs credits)
 *
 * Input job data: { campaignId, keywords[] }
 */
function startDirectoryFinderWorker(deps = {}) {
    const { rateLimiter, queues } = deps;
    const mode = config.directoryDiscovery.mode;

    return createWorker(QUEUE_NAMES.DIRECTORY_FINDER, async (job) => {
        const { campaignId, keywords } = job.data;
        if (!campaignId) throw new Error('Job requires campaignId');

        log.info({ campaignId, mode, keywords: keywords?.length }, 'starting directory discovery');

        let totalInserted = 0;

        // ═══════════════════════════════════════════
        //  LAYER 1: Curated Seed Lists (Always Active)
        // ═══════════════════════════════════════════
        log.info({ directories: directories.length, bookmarking: bookmarking.length }, 'Layer 1: importing curated seed lists');

        totalInserted += await importSeedList(directories, 'directory', campaignId);
        totalInserted += await importSeedList(bookmarking, 'social_bookmarking', campaignId);

        log.info({ totalInserted }, 'Layer 1 complete');

        // ═══════════════════════════════════════════
        //  LAYER 2: Directory Footprint Crawling (Always Active, Free)
        // ═══════════════════════════════════════════
        log.info('Layer 2: starting directory footprint crawling on discovered domains');

        const footprintResults = await crawlForFootprints(campaignId, rateLimiter);
        totalInserted += footprintResults;

        log.info({ footprintResults }, 'Layer 2 complete');

        // ═══════════════════════════════════════════
        //  LAYER 3: SERP Footprint Mining (Hybrid Only)
        // ═══════════════════════════════════════════
        if (mode === 'hybrid' && keywords?.length > 0) {
            log.info({ keywords: keywords.length }, 'Layer 3: SERP footprint mining (hybrid mode)');

            const serpResults = await serpFootprintMining(keywords, campaignId, rateLimiter);
            totalInserted += serpResults;

            log.info({ serpResults }, 'Layer 3 complete');
        } else if (mode === 'curated_only') {
            log.info('Layer 3 skipped (curated_only mode)');
        }

        // Enqueue email finder for high-score directory opportunities
        if (queues?.EMAIL_FINDER) {
            try {
                const { rows } = await db.query(
                    `SELECT domain FROM opportunities 
                     WHERE campaign_id = $1 AND opportunity_type IN ('directory', 'social_bookmarking') AND score >= 40`,
                    [campaignId]
                );
                for (const row of rows) {
                    try {
                        await queues.EMAIL_FINDER.add(
                            'find',
                            { domain: row.domain, campaignId },
                            { jobId: `email-${campaignId}-${row.domain}-${Date.now()}` }
                        );
                    } catch { /* already enqueued */ }
                }
                log.info({ count: rows.length }, 'enqueued email discovery for directory opportunities');
            } catch (err) {
                log.warn({ err: err.message }, 'failed to enqueue email jobs');
            }
        }

        await db.recordMetric('directory_discovery_complete', totalInserted, { mode }, campaignId);

        log.info({ campaignId, totalInserted, mode }, 'directory discovery complete');
        return { campaignId, totalInserted, mode };
    }, { concurrency: 1 });
}

// ═══════════════════════════════════════════════════════
//  Layer 1: Import curated seed list
// ═══════════════════════════════════════════════════════

async function importSeedList(list, type, campaignId) {
    let inserted = 0;
    let skippedDead = 0;
    const BATCH_SIZE = 10;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(batch.map(async (entry) => {
            const domain = normalizeDomain(entry.url);
            if (!domain) return null;

            // Liveness check — skip dead/unreachable URLs
            const alive = await checkUrlAlive(entry.url);
            if (!alive) {
                log.debug({ domain, url: entry.url }, 'seed URL dead, skipping');
                return null;
            }

            return { entry, domain };
        }));

        for (const result of results) {
            if (!result) { skippedDead++; continue; }
            const { entry, domain } = result;

            try {
                const dbResult = await db.query(
                    `INSERT INTO opportunities (domain, page_url, opportunity_type, score, status, notes, campaign_id)
                     VALUES ($1, $2, $3, $4, 'new', $5, $6)
                     ON CONFLICT DO NOTHING`,
                    [
                        domain,
                        entry.url + (entry.submitPath || ''),
                        type,
                        type === 'directory' ? 45 : 35,
                        `Curated: ${entry.name} (${entry.category})`,
                        campaignId,
                    ]
                );
                if (dbResult.rowCount > 0) inserted++;
            } catch (err) {
                log.debug({ err: err.message, domain }, 'seed insert failed');
            }
        }
    }

    log.info({ type, inserted, skippedDead, total: list.length }, 'seed list imported');
    return inserted;
}

/**
 * Quick liveness check — HEAD first, fallback to GET.
 */
async function checkUrlAlive(url) {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' };
    try {
        const resp = await axios.head(url, { timeout: 6000, maxRedirects: 3, validateStatus: (s) => s < 500, headers });
        return resp.status < 400;
    } catch {
        try {
            const resp = await axios.get(url, { timeout: 6000, maxRedirects: 3, validateStatus: (s) => s < 500, headers, maxContentLength: 50000 });
            return resp.status < 400;
        } catch {
            return false;
        }
    }
}

// ═══════════════════════════════════════════════════════
//  Layer 2: Footprint crawling on discovered domains
// ═══════════════════════════════════════════════════════

async function crawlForFootprints(campaignId, rateLimiter) {
    let found = 0;

    // Get all non-competitor domains from this campaign
    const { rows: domains } = await db.query(
        `SELECT normalized FROM domains 
         WHERE campaign_id = $1 AND is_competitor = FALSE AND quality_score >= 10
         LIMIT 200`,
        [campaignId]
    );

    log.info({ domainCount: domains.length }, 'probing domains for directory footprints');

    const probePaths = footprints.submissionPaths;

    for (const { normalized: domain } of domains) {
        // Skip if already classified as directory
        const { rows: existing } = await db.query(
            `SELECT id FROM opportunities WHERE domain = $1 AND campaign_id = $2 AND opportunity_type IN ('directory', 'social_bookmarking')`,
            [domain, campaignId]
        );
        if (existing.length > 0) continue;

        let isDirectory = false;
        let matchedPath = '';

        for (const probePath of probePaths) {
            const probeUrl = `https://${domain}${probePath}`;

            try {
                if (rateLimiter) await rateLimiter.waitForHost(domain);

                const response = await axios.head(probeUrl, {
                    timeout: 5000,
                    maxRedirects: 2,
                    validateStatus: (s) => s < 500,
                    headers: {
                        'User-Agent': rateLimiter?.getRandomUserAgent() || 'Mozilla/5.0 (compatible; SEOBot/1.0)',
                    },
                });

                if (rateLimiter) rateLimiter.onResponse(domain, response.status);

                if (response.status === 200) {
                    isDirectory = true;
                    matchedPath = probePath;
                    break;
                }
            } catch {
                // Probe failed — continue to next path
            }
        }

        if (isDirectory) {
            try {
                const result = await db.query(
                    `INSERT INTO opportunities (domain, page_url, opportunity_type, score, status, notes, campaign_id)
                     VALUES ($1, $2, 'directory', $3, 'new', $4, $5)
                     ON CONFLICT DO NOTHING`,
                    [
                        domain,
                        `https://${domain}${matchedPath}`,
                        50,
                        `Footprint detected: ${matchedPath}`,
                        campaignId,
                    ]
                );
                if (result.rowCount > 0) {
                    found++;
                    log.info({ domain, path: matchedPath }, 'directory detected via footprint');
                }
            } catch (err) {
                log.debug({ err: err.message, domain }, 'footprint opportunity insert failed');
            }
        }
    }

    return found;
}

// ═══════════════════════════════════════════════════════
//  Layer 3: SERP footprint mining
// ═══════════════════════════════════════════════════════

async function serpFootprintMining(keywords, campaignId, rateLimiter) {
    let found = 0;

    const directoryFootprints = [
        '"submit your site" + ',
        '"add listing" + ',
        'inurl:submit directory ',
        '"web directory" + ',
    ];

    const bookmarkingFootprints = [
        '"social bookmarking" + ',
        '"submit link" + ',
        '"bookmark this" + ',
    ];

    for (const keyword of keywords) {
        // Directory SERP queries
        for (const fp of directoryFootprints) {
            try {
                const query = `${fp}${keyword}`;
                const results = await search(query, 10, { rateLimiter });

                for (const result of results) {
                    const domain = normalizeDomain(result.url);
                    if (!domain) continue;

                    found += await insertSerpOpportunity(
                        domain, result.url, 'directory', keyword, campaignId
                    );
                }

                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                log.debug({ err: err.message, keyword }, 'directory SERP query failed');
            }
        }

        // Bookmarking SERP queries
        for (const fp of bookmarkingFootprints) {
            try {
                const query = `${fp}${keyword}`;
                const results = await search(query, 10, { rateLimiter });

                for (const result of results) {
                    const domain = normalizeDomain(result.url);
                    if (!domain) continue;

                    found += await insertSerpOpportunity(
                        domain, result.url, 'social_bookmarking', keyword, campaignId
                    );
                }

                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                log.debug({ err: err.message, keyword }, 'bookmarking SERP query failed');
            }
        }
    }

    return found;
}

async function insertSerpOpportunity(domain, url, type, keyword, campaignId) {
    try {
        const result = await db.query(
            `INSERT INTO opportunities (domain, page_url, opportunity_type, score, status, notes, campaign_id)
             VALUES ($1, $2, $3, $4, 'new', $5, $6)
             ON CONFLICT DO NOTHING`,
            [
                domain, url, type, 40,
                `SERP discovery: "${keyword}"`,
                campaignId,
            ]
        );
        return result.rowCount > 0 ? 1 : 0;
    } catch (err) {
        log.debug({ err: err.message, domain }, 'SERP opportunity insert failed');
        return 0;
    }
}

module.exports = { startDirectoryFinderWorker };
