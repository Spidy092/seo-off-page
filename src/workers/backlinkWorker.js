const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain, normalizeUrl } = require('../utils/normalizer');
const DedupEngine = require('../utils/dedup');
const db = require('../db');
const { search } = require('../services/serp');
const config = require('../config');
const axios = require('axios');
const cheerio = require('cheerio');

const log = createLogger('worker:backlink');
const dedup = new DedupEngine({ expectedItems: 500000 });

/**
 * Backlink Extraction Worker
 *
 * Input job data: { domain, targetDomain }
 *
 * Process:
 *  1. Crawl the competitor's pages
 *  2. Extract outbound links (backlinks they have)
 *  3. Store unique backlinks in DB
 *  4. Enqueue domain analysis for each new linking domain
 */
function startBacklinkWorker(deps = {}) {
    const { rateLimiter, queues } = deps;

    return createWorker(QUEUE_NAMES.BACKLINK_EXTRACTION, async (job) => {
        const { domain, campaignId } = job.data;

        if (!domain) throw new Error('Job requires domain');

        log.info({ domain }, 'starting backlink extraction');

        let backlinkCount = 0;
        const linkingDomains = new Set();

        try {
            // STEP 1: Find pages that mention the competitor using SERP footprint mining.
            // "competitordomain.com" -site:competitordomain.com
            const searchQuery = `"${domain}" -site:${domain}`;
            const searchResults = await search(searchQuery, 10, { rateLimiter });

            // Collect the URLs of the pages that mention the competitor
            const pagesToCrawl = searchResults.map(r => r.url).slice(0, 10); // cap to save time in dev

            // STEP 2: Crawl those referring pages to extract the exact anchor text and verify the link exists
            for (const pageUrl of pagesToCrawl) {
                try {
                    const fromDomain = normalizeDomain(pageUrl);
                    if (!fromDomain || SKIP_DOMAINS.has(fromDomain) || linkingDomains.has(fromDomain)) continue;

                    if (rateLimiter) {
                        await rateLimiter.waitForHost(fromDomain);
                        await rateLimiter.acquireConcurrency();
                    }

                    const { data: html, status } = await axios.get(pageUrl, {
                        timeout: 10000,
                        headers: {
                            'User-Agent': rateLimiter?.getRandomUserAgent() || 'Mozilla/5.0 (compatible; SEOBot/1.0)',
                        },
                        maxRedirects: 3,
                        validateStatus: (s) => s < 500,
                    });

                    if (rateLimiter) {
                        rateLimiter.onResponse(fromDomain, status);
                        rateLimiter.releaseConcurrency();
                    }

                    if (status !== 200 || typeof html !== 'string') continue;

                    // Extract outbound links from this referring page
                    const $ = cheerio.load(html);
                    let foundBacklink = false;
                    let anchorText = '';
                    let toUrl = `https://${domain}`;

                    $('a[href]').each((_, el) => {
                        const href = $(el).attr('href');
                        if (href && href.includes(domain)) {
                            foundBacklink = true;
                            toUrl = href;
                            anchorText = $(el).text().trim().slice(0, 255);
                            return false; // Break out of the .each loop
                        }
                    });

                    // If we successfully verified the backlink exists on the page
                    if (foundBacklink) {
                        linkingDomains.add(fromDomain);
                        backlinkCount++;

                        await db.query(
                            `INSERT INTO backlinks (from_domain, to_domain, from_url, to_url, anchor_text, source, campaign_id)
                             VALUES ($1, $2, $3, $4, $5, 'serp_crawl', $6)
                             ON CONFLICT DO NOTHING`,
                            [fromDomain, domain, pageUrl, toUrl, anchorText, campaignId]
                        ).catch(err => log.error({ err: err.message }, 'backlink insert error'));

                        // Enqueue Domain Analysis for this newly found referring domain
                        if (queues?.DOMAIN_ANALYSIS) {
                            try {
                                await queues.DOMAIN_ANALYSIS.add(
                                    'analyze',
                                    { domain: fromDomain, campaignId },
                                    { jobId: `analyze-${campaignId}-${fromDomain}` }
                                );
                            } catch { /* duplicate */ }
                        }
                    }

                } catch (err) {
                    if (rateLimiter) rateLimiter.releaseConcurrency();
                    log.debug({ err: err.message, url: pageUrl }, 'referring page crawl failed');
                }
            }
        } catch (err) {
            log.error({ err: err.message, domain }, 'backlink extraction via SERP failed');
        }

        await db.recordMetric('backlinks_extracted', backlinkCount, { domain }, campaignId);

        log.info({ domain, backlinkCount, uniqueDomains: linkingDomains.size }, 'backlink extraction complete');
        return { domain, backlinkCount, uniqueDomains: linkingDomains.size };
    }, { concurrency: 2 });
}

const SKIP_DOMAINS = new Set([
    'google.com', 'facebook.com', 'twitter.com', 'youtube.com', 'instagram.com',
    'linkedin.com', 'pinterest.com', 'reddit.com', 'wikipedia.org', 'amazon.com',
    'apple.com', 'microsoft.com', 'github.com', 'stackoverflow.com',
    'w3.org', 'schema.org', 'fonts.googleapis.com', 'ajax.googleapis.com',
    'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com',
]);

module.exports = { startBacklinkWorker };
