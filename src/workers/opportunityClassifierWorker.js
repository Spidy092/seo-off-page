const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const nlp = require('compromise');
const { analyzeWithAI } = require('../services/aiAnalyzer');

const log = createLogger('worker:classifier');

/**
 * Opportunity Classifier Worker
 *
 * Input job data: { domain, pageUrl }
 *
 * Classifies a page into opportunity types by analyzing content:
 *   - guest_post:     "write for us", "guest post guidelines", "contribute"
 *   - resource_page:  "resources", "useful links", "blogroll", "tools"
 *   - directory:      categorized listings
 *   - forum:          open discussion, comments
 *   - niche_edit:     existing content where a link could fit
 */

const OPPORTUNITY_PATTERNS = {
    guest_post: {
        keywords: [
            'write for us', 'guest post', 'guest blog', 'contribute an article',
            'submit a post', 'guest author', 'submission guidelines',
            'become a contributor', 'write for our blog', 'accept guest posts',
            'guest posting', 'content submission',
        ],
        score: 90,
    },
    resource_page: {
        keywords: [
            'resources', 'useful links', 'recommended tools', 'helpful sites',
            'link roundup', 'best resources', 'tools we use', 'blogroll',
            'recommended reading', 'useful websites', 'curated list',
        ],
        score: 80,
    },
    listicle: {
        keywords: [
            'top 10', 'best tools', 'top companies', 'top sites', 'best alternatives',
            'top software', 'top services', 'ranked list',
        ],
        score: 75,
    },
    directory: {
        keywords: [
            'directory', 'submit your site', 'add your site',
            'suggest a site', 'web directory', 'submit url',
            'business directory', 'listing', 'add listing',
            'add your website', 'free directory', 'submit website',
            'site submission', 'add your business', 'list your business',
        ],
        score: 40,
    },
    social_bookmarking: {
        keywords: [
            'bookmark', 'submit link', 'save to bookmarks', 'social bookmarking',
            'add bookmark', 'bookmarking site', 'share link', 'submit story',
            'save link', 'bookmark this page', 'social sharing',
        ],
        score: 35,
    },
    blog_mention: {
        keywords: [
            'as seen on', 'we love using', 'highly recommend', 'recently tried',
            'check out this', 'shoutout to',
        ],
        score: 50,
    },
    forum: {
        keywords: [
            'forum', 'discussion', 'community', 'leave a comment',
            'join the conversation', 'reply to this',
        ],
        score: 20,
    },
};

function startOpportunityClassifierWorker(deps = {}) {
    const { rateLimiter } = deps;

    return createWorker(QUEUE_NAMES.OPPORTUNITY_CLASSIFIER, async (job) => {
        const { domain, pageUrl, campaignId, intersectCount } = job.data;
        if (!domain) throw new Error('Job requires domain');

        const normalized = normalizeDomain(domain);
        const url = pageUrl || `https://${normalized}`;

        log.info({ domain: normalized, url }, 'classifying opportunity');

        let classification = { type: 'unknown', score: 0, signals: [] };
        let html = null;

        try {
            if (rateLimiter) await rateLimiter.waitForHost(normalized);

            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': rateLimiter?.getRandomUserAgent() ||
                        'Mozilla/5.0 (compatible; SEOBot/1.0)',
                },
                maxRedirects: 3,
                validateStatus: (s) => s < 500,
            });

            html = response.data;
            const status = response.status;

            if (rateLimiter) rateLimiter.onResponse(normalized, status);

            if (status === 200 && typeof html === 'string') {
                classification = classifyPage(html, url);
            }
        } catch (err) {
            log.debug({ err: err.message, url }, 'classification crawl failed');
        }

        // ─── Fetch domain quality score and campaign data from DB ───
        let domainScore = 0;
        let targetDomain = '';
        let competitors = [];
        try {
            const { rows: dRows } = await db.query(
                'SELECT quality_score FROM domains WHERE normalized = $1 AND campaign_id = $2', [normalized, campaignId]
            );
            domainScore = dRows[0]?.quality_score || 0;

            const { rows: cRows } = await db.query(
                'SELECT target_domain FROM campaigns WHERE id = $1', [campaignId]
            );
            targetDomain = cRows[0]?.target_domain || '';

            const { rows: compRows } = await db.query(
                'SELECT normalized FROM domains WHERE is_competitor = TRUE AND campaign_id = $1', [campaignId]
            );
            competitors = compRows.map(r => r.normalized);
        } catch { /* ignore */ }

        // ─── Anchor Context Extraction & AI Relevancy ───
        let aiAnalysis = null;
        let relevanceMultiplier = 1.0;
        let contextText = '';

        if (competitors.length > 0 && typeof html === 'string') {
            try {
                const $ = cheerio.load(html);

                // 1. Remove non-contextual areas first
                $('nav, footer, header, .sidebar, #sidebar, .widget, .menu, .comments').remove();

                // Find all links that point to our competitors
                $('a[href]').each((_, el) => {
                    const href = $(el).attr('href');
                    if (!href) return;

                    for (const comp of competitors) {
                        if (href.includes(comp)) {
                            const $el = $(el);

                            // 2. Resource/List Page detection
                            // If the link is inside an LI or a tight div list, it's likely a listicle or resource page
                            const parentLi = $el.closest('li');
                            if (parentLi.length > 0) {
                                // Force "resource_page" signal if it's in a list
                                classification.type = 'resource_page';
                            }

                            // 3. Extract broader context
                            // Try to get the parent paragraph or list item
                            let parentText = '';
                            const parentP = $el.closest('p, li, .post-content, article');
                            if (parentP.length > 0) {
                                parentText = parentP.text().replace(/\s+/g, ' ').trim();
                            } else {
                                // Fallback to direct parent if no block element found
                                parentText = $el.parent().text().replace(/\s+/g, ' ').trim();
                            }

                            // If we haven't found a context yet, or if this one is meatier
                            if (parentText.length > 20 && parentText.length < 3000 && parentText.length > contextText.length) {
                                // Cap to ~1000 characters to save AI tokens
                                contextText = parentText.slice(0, 1000);
                            }
                        }
                    }
                });

                // 4. AI Cost Control & Topic Similarity
                // Only run the LLM if the domain is actually worth our time / money
                if (contextText.length > 0 && (intersectCount >= 1 || domainScore >= 30)) {
                    log.info({ domain: normalized, contextLength: contextText.length }, 'sending anchor context to AI providers');
                    aiAnalysis = await analyzeWithAI(contextText, targetDomain);

                    // Penalty/Bonus based on AI interpretation
                    if (!aiAnalysis.isRelevant || aiAnalysis.topicSimilarityScore < 30) {
                        relevanceMultiplier = 0.1; // Junk context
                    } else if (aiAnalysis.topicSimilarityScore >= 80) {
                        relevanceMultiplier = 1.5; // Highly relevant
                    }

                    // Override classification if AI strongly detects intent
                    if (aiAnalysis.linkIntent && classification.type === 'unknown') {
                        // Map standardized AI intents to our system
                        if (aiAnalysis.linkIntent === 'listicle') classification.type = 'listicle';
                        else if (aiAnalysis.linkIntent === 'blog_mention') classification.type = 'blog_mention';
                        else classification.type = aiAnalysis.linkIntent;
                    }
                } else if (contextText.length > 0) {
                    // We found context, but score/intersects didn't justify an AI call
                    relevanceMultiplier = 1.0;
                } else {
                    relevanceMultiplier = 0.3; // Heavy penalty: Link exists, but it's probably boiler-plate/hidden/sidebar
                }
            } catch (err) {
                log.warn({ err: err.message, domain: normalized }, 'AI relevance extraction failed');
            }
        }

        // ─── Combined score ───
        const baseScore = Math.round((classification.score * 0.4) + (domainScore * 0.6));
        const finalScore = Math.round(baseScore * relevanceMultiplier);

        const notesStr = aiAnalysis
            ? `AI Intent: ${aiAnalysis.linkIntent} | Similarity: ${aiAnalysis.topicSimilarityScore}/100`
            : 'AI Analysis skipped or failed.';

        // ─── Store opportunity ───
        await db.query(
            `INSERT INTO opportunities (
                domain, page_url, opportunity_type, score, status, notes, campaign_id,
                competitor_intersect_count, ai_outreach_hook, ai_relevance_score, link_intent, anchor_context
            ) VALUES ($1, $2, $3, $4, 'new', $5, $6, $7, $8, $9, $10, $11)`,
            [
                normalized, url, classification.type, finalScore, notesStr, campaignId,
                intersectCount || 0,
                aiAnalysis?.outreachHook || null,
                aiAnalysis?.topicSimilarityScore || null,
                aiAnalysis?.linkIntent || null,
                contextText || null
            ]
        );

        // ─── Enqueue email finder for high-score opportunities ───
        if (finalScore >= 50 && deps.queues && deps.queues.EMAIL_FINDER) {
            try {
                await deps.queues.EMAIL_FINDER.add(
                    'find',
                    { domain: normalized, campaignId },
                    { jobId: `email-${campaignId}-${normalized}-${Date.now()}` }
                );
            } catch { /* already enqueued */ }
        }

        await db.recordMetric('opportunities_classified', 1, {
            domain: normalized, type: classification.type, score: finalScore,
        }, campaignId);

        log.info({ domain: normalized, type: classification.type, score: finalScore, signals: classification.signals },
            'classification complete');

        return { domain: normalized, type: classification.type, score: finalScore };
    }, { concurrency: 3 });
}

/**
 * Analyze page content and classify the opportunity type.
 */
function classifyPage(html, url) {
    const $ = cheerio.load(html);
    const textContent = $('body').text().toLowerCase();
    const title = $('title').text().toLowerCase();
    const urlLower = url.toLowerCase();

    let bestMatch = { type: 'niche_edit', score: 30, signals: [] };

    for (const [type, config] of Object.entries(OPPORTUNITY_PATTERNS)) {
        const matchedKeywords = config.keywords.filter(kw =>
            textContent.includes(kw) || title.includes(kw) || urlLower.includes(kw.replace(/\s+/g, '-'))
        );

        if (matchedKeywords.length > 0) {
            const matchScore = Math.min(
                config.score,
                config.score * (matchedKeywords.length / 3) // More matches = higher confidence
            );

            if (matchScore > bestMatch.score) {
                bestMatch = { type, score: matchScore, signals: matchedKeywords };
            }
        }
    }

    return bestMatch;
}

module.exports = { startOpportunityClassifierWorker, classifyPage };
