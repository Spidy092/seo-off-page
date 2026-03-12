const db = require('../db');
const { normalizeDomain } = require('../utils/normalizer');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const nlp = require('compromise');

/**
 * Register automation trigger API routes.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} deps - { queues }
 */
async function automationRoutes(fastify, deps) {
    const { queues } = deps;

    // ═════════════════════════════════════
    //  Start Full Pipeline
    // ═════════════════════════════════════

    /**
     * POST /api/pipeline/start
     * Body: { targetDomain: string, keywords: string[] }
     *
     * Kicks off the full automation:
     *   1. Competitor discovery (SERP search)
     *   2. → auto-chains backlink extraction
     *   3. → auto-chains domain analysis
     *   4. → auto-chains email finding
     *   5. → auto-chains opportunity classification
     */
    fastify.post('/api/pipeline/start', {
        schema: {
            body: {
                type: 'object',
                required: ['targetDomain', 'keywords'],
                properties: {
                    targetDomain: { type: 'string' },
                    keywords: { type: 'array', items: { type: 'string' }, minItems: 1 },
                },
            },
        },
    }, async (req, reply) => {
        const { targetDomain, keywords } = req.body;
        const normalized = normalizeDomain(targetDomain);

        // Create campaign
        const campaign = await db.createCampaign(normalized, keywords);

        // Store the target domain
        await db.query(
            `INSERT INTO domains (domain, normalized, campaign_id)
       VALUES ($1, $2, $3) ON CONFLICT (normalized, campaign_id) DO NOTHING`,
            [normalized, normalized, campaign.id]
        );

        // Enqueue competitor discovery
        const job = await queues.COMPETITOR_DISCOVERY.add(
            'discover',
            { targetDomain: normalized, keywords, campaignId: campaign.id },
            { jobId: `competitor-${campaign.id}-${normalized}-${Date.now()}` }
        );

        // Enqueue directory & bookmarking discovery
        if (queues.DIRECTORY_FINDER) {
            await queues.DIRECTORY_FINDER.add(
                'discover-directories',
                { campaignId: campaign.id, keywords },
                { jobId: `dirfind-${campaign.id}-${Date.now()}` }
            );
        }

        return reply.code(202).send({
            message: 'Pipeline started',
            campaignId: campaign.id,
            targetDomain: normalized,
            keywords,
            jobId: job.id,
        });
    });

    // ═════════════════════════════════════
    //  Stop Campaign
    // ═════════════════════════════════════

    /**
     * POST /api/pipeline/stop/:campaignId
     * Drains all queued/delayed jobs for a specific campaign and marks it stopped.
     */
    fastify.post('/api/pipeline/stop/:campaignId', async (req, reply) => {
        const campaignId = parseInt(req.params.campaignId);
        if (!campaignId) return reply.code(400).send({ error: 'Invalid campaignId' });

        let totalRemoved = 0;

        for (const [key, queue] of Object.entries(queues)) {
            try {
                // Remove waiting jobs for this campaign
                const waiting = await queue.getJobs(['waiting', 'delayed']);
                for (const job of waiting) {
                    if (job.data?.campaignId === campaignId) {
                        await job.remove();
                        totalRemoved++;
                    }
                }
            } catch (err) {
                // Some jobs may already be active/locked — skip them
            }
        }

        // Mark campaign as stopped in DB
        try {
            await db.query(
                "UPDATE campaigns SET status = 'stopped', completed_at = NOW() WHERE id = $1",
                [campaignId]
            );
        } catch { /* ignore */ }

        return reply.send({
            message: `Campaign ${campaignId} stopped`,
            jobsRemoved: totalRemoved,
        });
    });

    // ═════════════════════════════════════
    //  Manual Job Triggers
    // ═════════════════════════════════════

    /** POST /api/jobs/backlink-extract — { domain } */
    fastify.post('/api/jobs/backlink-extract', async (req, reply) => {
        const { domain } = req.body;
        const normalized = normalizeDomain(domain);
        const job = await queues.BACKLINK_EXTRACTION.add(
            'extract', { domain: normalized }, { jobId: `backlink-${normalized}` }
        );
        return reply.code(202).send({ jobId: job.id, domain: normalized });
    });

    /** POST /api/jobs/analyze-domain — { domain } */
    fastify.post('/api/jobs/analyze-domain', async (req, reply) => {
        const { domain } = req.body;
        const normalized = normalizeDomain(domain);
        const job = await queues.DOMAIN_ANALYSIS.add(
            'analyze', { domain: normalized }, { jobId: `analyze-${normalized}` }
        );
        return reply.code(202).send({ jobId: job.id, domain: normalized });
    });

    /** POST /api/jobs/find-email — { domain } */
    fastify.post('/api/jobs/find-email', async (req, reply) => {
        const { domain } = req.body;
        const normalized = normalizeDomain(domain);
        const job = await queues.EMAIL_FINDER.add(
            'find', { domain: normalized }, { jobId: `email-${normalized}` }
        );
        return reply.code(202).send({ jobId: job.id, domain: normalized });
    });

    /** POST /api/jobs/check-broken-links — { pageUrl } */
    fastify.post('/api/jobs/check-broken-links', async (req, reply) => {
        const { pageUrl } = req.body;
        const job = await queues.BROKEN_LINK.add(
            'check', { pageUrl, sourceDomain: normalizeDomain(pageUrl) }
        );
        return reply.code(202).send({ jobId: job.id, pageUrl });
    });

    /** POST /api/jobs/classify — { domain, pageUrl } */
    fastify.post('/api/jobs/classify', async (req, reply) => {
        const { domain, pageUrl } = req.body;
        const normalized = normalizeDomain(domain);
        const job = await queues.OPPORTUNITY_CLASSIFIER.add(
            'classify', { domain: normalized, pageUrl },
            { jobId: `classify-${normalized}` }
        );
        return reply.code(202).send({ jobId: job.id, domain: normalized });
    });

    // ═════════════════════════════════════
    //  Data Query & Tool Endpoints
    // ═════════════════════════════════════

    /** GET /api/tools/extract-keywords — Scrape a domain and generate keywords using NLP */
    fastify.get('/api/tools/extract-keywords', async (req, reply) => {
        const domain = req.query.domain;
        if (!domain) {
            return reply.code(400).send({ error: 'Domain is required' });
        }

        const normalized = normalizeDomain(domain);
        const url = `https://${normalized}`;

        try {
            const { data: html } = await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
                maxRedirects: 3,
                validateStatus: (s) => s < 500,
            });

            // 1. Clean HTML via JSDOM & Readability
            const doc = new JSDOM(html, { url });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            const metaDesc = doc.window.document.querySelector('meta[name="description"]')?.content || '';
            const title = article?.title || doc.window.document.title || '';
            const textContent = article?.textContent || doc.window.document.body?.textContent || '';

            // Give higher weight to title and description by repeating them
            const fullText = `${title} ${title} ${metaDesc} ${metaDesc} ${textContent}`.toLowerCase();

            // 2. Perform NLP Analysis using Compromise
            let docNlp = nlp(fullText);

            // Extract noun phrases and get their frequencies
            let nouns = docNlp.nouns().out('frequency');

            const blacklist = new Set(['home', 'about', 'contact', 'services', 'solutions', 'privacy policy', 'terms of use', 'all rights reserved', 'copyright', 'read more', 'learn more', 'cookie', 'cookies', 'website', 'domain']);
            let extracted = [];

            // 3. Filter and rank n-grams
            for (const item of nouns) {
                const term = item.normal;
                const wordCount = term.split(' ').length;

                if (blacklist.has(term)) continue;

                // Heavily prefer 2-to-3 word business phrases (n-grams)
                if (wordCount >= 2 && wordCount <= 4 && term.length > 5) {
                    extracted.push({ term, score: item.count * 1.5 }); // Boost multi-word phrases
                } else if (wordCount === 1 && term.length > 4 && item.count > 2) {
                    // Include high-frequency single words
                    extracted.push({ term, score: item.count });
                }
            }

            // Sort by frequency/score and limit to top 10
            extracted.sort((a, b) => b.score - a.score);
            let results = extracted.slice(0, 10).map(x => x.term);

            // Fallback
            if (results.length === 0) {
                results = [normalized.split('.')[0], 'services', 'solutions'];
            }

            // Deduplicate exact substring overlaps (e.g. "edible oil" vs "edible oil manufacturer")
            let finalResults = [];
            for (let i = 0; i < results.length; i++) {
                let isSubset = false;
                for (let j = 0; j < results.length; j++) {
                    if (i !== j && results[j].includes(results[i]) && results[j] !== results[i]) {
                        isSubset = true;
                        break;
                    }
                }
                if (!isSubset) finalResults.push(results[i]);
            }

            // If deductive filtering removed too many, just return the raw top 10
            if (finalResults.length < 3) finalResults = results;

            return { keywords: finalResults.slice(0, 10) };
        } catch (err) {
            req.log.error({ err: err.message, domain }, 'NLP keyword extraction failed');
            return { keywords: [normalized.split('.')[0]] }; // Absolute fallback
        }
    });

    /** GET /api/campaigns — List all campaigns */
    fastify.get('/api/campaigns', async () => {
        const { rows } = await db.query('SELECT * FROM campaigns ORDER BY created_at DESC');
        return rows;
    });

    /** GET /api/opportunities — List scored opportunities */
    fastify.get('/api/opportunities', async (req) => {
        const limit = Math.min(parseInt(req.query.limit || '50'), 500);
        const minScore = parseFloat(req.query.minScore || '0');
        const type = req.query.type;
        const status = req.query.status || 'new';
        const campaignId = req.query.campaignId;

        let sql = `
            SELECT 
                o.*, 
                string_agg(DISTINCT c.email, ', ') as contact_email, 
                string_agg(DISTINCT c.name, ', ') as contact_name, 
                d.quality_score as domain_score
            FROM opportunities o
            LEFT JOIN contacts c ON c.domain = o.domain
            LEFT JOIN domains d ON d.normalized = o.domain
            WHERE o.score >= $1 AND o.status = $2
        `;
        const params = [minScore, status];

        if (type) {
            params.push(type);
            sql += ` AND o.opportunity_type = $${params.length}`;
        }
        if (campaignId) {
            params.push(campaignId);
            sql += ` AND o.campaign_id = $${params.length}`;
        }

        const limitParamIndex = params.length + 1;
        sql += ` GROUP BY o.id, d.quality_score ORDER BY o.score DESC LIMIT $${limitParamIndex}`;
        params.push(limit);

        const { rows } = await db.query(sql, params);
        return rows;
    });

    /** GET /api/domains — List analyzed domains */
    fastify.get('/api/domains', async (req) => {
        const limit = Math.min(parseInt(req.query.limit || '50'), 500);
        const minScore = parseFloat(req.query.minScore || '0');
        const campaignId = req.query.campaignId;

        let sql = `SELECT * FROM domains WHERE quality_score >= $1`;
        const params = [minScore];

        if (campaignId) {
            params.push(campaignId);
            sql += ` AND campaign_id = $${params.length}`;
        }

        params.push(limit);
        sql += ` ORDER BY quality_score DESC LIMIT $${params.length}`;

        const { rows } = await db.query(sql, params);
        return rows;
    });

    /** GET /api/backlinks/:domain — Get backlinks for a domain */
    fastify.get('/api/backlinks/:domain', async (req) => {
        const domain = normalizeDomain(req.params.domain);
        const limit = Math.min(parseInt(req.query.limit || '100'), 1000);

        const { rows } = await db.query(
            `SELECT * FROM backlinks WHERE to_domain = $1
       ORDER BY discovered_at DESC LIMIT $2`,
            [domain, limit]
        );
        return rows;
    });

    /** GET /api/contacts/:domain — Get contacts for a domain */
    fastify.get('/api/contacts/:domain', async (req) => {
        const domain = normalizeDomain(req.params.domain);
        const { rows } = await db.query(
            `SELECT * FROM contacts WHERE domain = $1 ORDER BY discovered_at DESC`,
            [domain]
        );
        return rows;
    });

    /** GET /api/broken-links — List broken links */
    fastify.get('/api/broken-links', async (req) => {
        const limit = Math.min(parseInt(req.query.limit || '50'), 500);
        const { rows } = await db.query(
            `SELECT * FROM broken_links ORDER BY discovered_at DESC LIMIT $1`,
            [limit]
        );
        return rows;
    });
}

module.exports = automationRoutes;
