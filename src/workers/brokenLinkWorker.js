const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');
const axios = require('axios');
const cheerio = require('cheerio');

const log = createLogger('worker:broken-link');

/**
 * Broken Link Discovery Worker (Hybrid — Linkinator + Cheerio filtering)
 *
 * Input job data: { pageUrl, sourceDomain, campaignId }
 *
 * Strategy:
 *  1. Pre-pass with Cheerio to collect anchor texts for each outbound link.
 *  2. Use Linkinator to validate ALL links on the page (handles retries, 429s, etc.).
 *  3. Filter results to keep only EXTERNAL broken links.
 *  4. Store them with anchor text as broken link opportunities.
 *
 * Why hybrid?  Linkinator handles all the hard networking edge cases
 * (retries, 429/Retry-After, timeouts, redirect loops, connection errors)
 * while our filter logic ensures we only care about external outbound links.
 * Cheerio pre-pass preserves anchor text data that Linkinator doesn't expose.
 */
function startBrokenLinkWorker(deps = {}) {
    const { rateLimiter } = deps;

    return createWorker(QUEUE_NAMES.BROKEN_LINK, async (job) => {
        const { pageUrl, sourceDomain, campaignId } = job.data;
        if (!pageUrl) throw new Error('Job requires pageUrl');

        const domain = sourceDomain || normalizeDomain(pageUrl);
        log.info({ pageUrl, domain }, 'checking for broken links via linkinator');

        let brokenCount = 0;
        let checkedCount = 0;

        try {
            if (rateLimiter) await rateLimiter.waitForHost(domain);

            // ── Step 1: Cheerio pre-pass to collect anchor texts ──
            const anchorMap = new Map(); // url → anchorText
            try {
                const { data: html } = await axios.get(pageUrl, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': rateLimiter?.getRandomUserAgent() ||
                            'Mozilla/5.0 (compatible; SEOBot/1.0)',
                    },
                    maxRedirects: 3,
                    validateStatus: (s) => s < 500,
                });
                if (typeof html === 'string') {
                    const $ = cheerio.load(html);
                    $('a[href]').each((_, el) => {
                        const href = $(el).attr('href');
                        if (!href) return;
                        try {
                            const fullUrl = new URL(href, pageUrl).toString();
                            const text = $(el).text().trim().slice(0, 255);
                            if (text) anchorMap.set(fullUrl, text);
                        } catch { /* ignore malformed URLs */ }
                    });
                }
            } catch (err) {
                log.warn({ err: err.message, pageUrl }, 'anchor text pre-pass failed, continuing without anchors');
            }

            // ── Step 2: Linkinator scan for robust link validation ──
            const { LinkChecker } = await import('linkinator');
            const checker = new LinkChecker();

            checker.on('link', (result) => {
                log.debug({ url: result.url, state: result.state, status: result.status }, 'link checked');
            });

            const result = await checker.check({
                path: pageUrl,
                recurse: false,              // Shallow — only check links on THIS page
                timeout: 10000,              // 10s per request
                concurrency: 25,             // Enough parallelism without hammering hosts
                retry: true,                 // Respect Retry-After headers on 429s
                linksToSkip: [
                    'mailto:',               // Skip email links
                    '^javascript:',          // Skip JS pseudo-links
                    'tel:',                  // Skip phone links
                ],
                userAgent: rateLimiter?.getRandomUserAgent() ||
                    'Mozilla/5.0 (compatible; SEOBot/1.0)',
            });

            // ── Step 3: Filter to EXTERNAL broken links only ──
            for (const link of result.links) {
                const linkDomain = normalizeDomain(link.url);
                if (!linkDomain || linkDomain === domain) continue;

                checkedCount++;

                if (link.state === 'BROKEN') {
                    brokenCount++;

                    const anchorText = anchorMap.get(link.url) || '';

                    await db.query(
                        `INSERT INTO broken_links (source_page, source_domain, broken_url, anchor_text, http_status, campaign_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (source_page, broken_url, campaign_id) DO NOTHING`,
                        [pageUrl, domain, link.url, anchorText, link.status || 0, campaignId]
                    );

                    log.info({ brokenUrl: link.url, status: link.status },
                        'broken link found');
                }
            }
        } catch (err) {
            log.error({ err: err.message, pageUrl }, 'broken link check failed');
        }

        await db.recordMetric('broken_links_found', brokenCount, { domain });

        log.info({ pageUrl, checked: checkedCount, broken: brokenCount }, 'broken link check complete');
        return { pageUrl, checked: checkedCount, broken: brokenCount };
    }, { concurrency: 2 });
}

module.exports = { startBrokenLinkWorker };
