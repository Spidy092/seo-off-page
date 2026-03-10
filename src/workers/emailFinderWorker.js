const { createWorker, QUEUE_NAMES } = require('../queue');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const log = createLogger('worker:email-finder');

/**
 * Email Finder Worker
 *
 * Input job data: { domain }
 *
 * Multi-source email discovery pipeline:
 *   Step 1: Scrape contact/about pages (free, unlimited)
 *   Step 2: Hunter.io API (25/month)
 *   Step 3: Snov.io API (50/month)
 *   Step 4: Pattern-based guessing
 *   Step 5: WHOIS (via Wayback/Web)
 */
function startEmailFinderWorker(deps = {}) {
    const { rateLimiter } = deps;

    return createWorker(QUEUE_NAMES.EMAIL_FINDER, async (job) => {
        const { domain, campaignId } = job.data;
        if (!domain) throw new Error('Job requires domain');

        const normalized = normalizeDomain(domain);
        log.info({ domain: normalized }, 'starting email discovery');

        const emails = new Map(); // email → { source, name, role }

        // ─── Step 1: Page Scraping (always runs first, free) ───
        try {
            const scraped = await scrapeContactPages(normalized, rateLimiter);
            for (const e of scraped) {
                if (!emails.has(e.email)) emails.set(e.email, { ...e, source: 'scraped' });
            }
        } catch (err) {
            log.debug({ err: err.message, domain: normalized }, 'page scraping failed');
        }

        // ─── Step 1.5: WHOIS Extraction (free) ───
        if (emails.size < 2) {
            try {
                const whoisEmails = await scrapeWhoisEmail(normalized);
                for (const e of whoisEmails) {
                    if (!emails.has(e.email)) emails.set(e.email, { ...e, source: 'whois' });
                }
            } catch (err) {
                log.debug({ err: err.message, domain: normalized }, 'whois scraping failed');
            }
        }

        // If we already found emails via scraping/whois, skip APIs (save quota)
        if (emails.size < 2) {
            // ─── Step 2: Hunter.io ───
            if (config.apis.hunter.key) {
                try {
                    const hasQuota = rateLimiter
                        ? await rateLimiter.checkQuota('api.hunter.io', config.apis.hunter.dailyLimit)
                        : true;

                    if (hasQuota) {
                        const hunterEmails = await searchHunter(normalized);
                        for (const e of hunterEmails) {
                            if (!emails.has(e.email)) emails.set(e.email, { ...e, source: 'hunter' });
                        }
                    }
                } catch (err) {
                    log.debug({ err: err.message }, 'Hunter.io failed');
                }
            }

            // ─── Step 3: Snov.io ───
            if (config.apis.snov.key && emails.size < 2) {
                try {
                    const hasQuota = rateLimiter
                        ? await rateLimiter.checkQuota('api.snov.io', config.apis.snov.dailyLimit)
                        : true;

                    if (hasQuota) {
                        const snovEmails = await searchSnov(normalized);
                        for (const e of snovEmails) {
                            if (!emails.has(e.email)) emails.set(e.email, { ...e, source: 'snov' });
                        }
                    }
                } catch (err) {
                    log.debug({ err: err.message }, 'Snov.io failed');
                }
            }
        }

        // ─── Step 4: Pattern-based guessing ───
        if (emails.size === 0) {
            const guessed = generateCommonPatterns(normalized);
            for (const e of guessed) {
                if (!emails.has(e.email)) emails.set(e.email, { ...e, source: 'pattern' });
            }
        }

        // ─── Store in DB ───
        for (const [email, info] of emails) {
            try {
                await db.query(
                    `INSERT INTO contacts (domain, email, name, role, source, campaign_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (domain, email, campaign_id) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, contacts.name),
             source = EXCLUDED.source`,
                    [normalized, email, info.name || null, info.role || null, info.source, campaignId]
                );
            } catch (err) {
                log.error({ err: err.message, email }, 'contact insert error');
            }
        }

        await db.recordMetric('emails_found', emails.size, { domain: normalized }, campaignId);

        log.info({ domain: normalized, count: emails.size }, 'email discovery complete');
        return { domain: normalized, emailsFound: emails.size, emails: [...emails.keys()] };
    }, { concurrency: 2 });
}

// ═════════════════════════════════════════════
//  Step 1: Page scraping
// ═════════════════════════════════════════════

async function scrapeContactPages(domain, rateLimiter) {
    const emails = [];
    const pages = [
        `https://${domain}/contact`,
        `https://${domain}/contact-us`,
        `https://${domain}/about`,
        `https://${domain}/about-us`,
        `https://${domain}/team`,
        `https://${domain}/write-for-us`,
        `https://${domain}/contribute`,
    ];

    for (const url of pages) {
        try {
            if (rateLimiter) await rateLimiter.waitForHost(domain);

            const { data: html, status } = await axios.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': rateLimiter?.getRandomUserAgent() ||
                        'Mozilla/5.0 (compatible; SEOBot/1.0)',
                },
                maxRedirects: 3,
                validateStatus: (s) => s < 500,
            });

            if (rateLimiter) rateLimiter.onResponse(domain, status);
            if (status !== 200 || typeof html !== 'string') continue;

            // Extract mailto: links
            const $ = cheerio.load(html);
            $('a[href^="mailto:"]').each((_, el) => {
                const email = $(el).attr('href').replace('mailto:', '').split('?')[0].trim().toLowerCase();
                if (isValidEmail(email)) {
                    emails.push({ email, name: $(el).text().trim() || null });
                }
            });

            // Extract emails from text content using regex
            const textContent = $('body').text();
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const found = textContent.match(emailRegex) || [];
            for (const email of found) {
                const clean = email.toLowerCase();
                if (isValidEmail(clean) && !emails.some(e => e.email === clean)) {
                    emails.push({ email: clean });
                }
            }

        } catch { /* skip failed pages */ }
    }

    return emails;
}

// ═════════════════════════════════════════════
//  Step 1.5: WHOIS Extraction
// ═════════════════════════════════════════════

async function scrapeWhoisEmail(domain) {
    try {
        const { stdout } = await execPromise(`whois ${domain}`, { timeout: 5000 });
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const found = stdout.match(emailRegex) || [];
        const emails = [];

        for (const email of found) {
            const clean = email.toLowerCase();
            // Filter out obvious privacy protection emails
            const isPrivacy = clean.includes('privacy') || clean.includes('whois') ||
                clean.includes('redacted') || clean.includes('protect') ||
                clean.includes('domainadmin');

            if (isValidEmail(clean) && !isPrivacy && !emails.some(e => e.email === clean)) {
                emails.push({ email: clean });
            }
        }
        return emails.slice(0, 3);
    } catch { return []; }
}

// ═════════════════════════════════════════════
//  Step 2: Hunter.io
// ═════════════════════════════════════════════

async function searchHunter(domain) {
    const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: config.apis.hunter.key },
        timeout: 10000,
    });

    return (data?.data?.emails || []).map(e => ({
        email: e.value,
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        role: e.position || null,
    }));
}

// ═════════════════════════════════════════════
//  Step 3: Snov.io
// ═════════════════════════════════════════════

async function searchSnov(domain) {
    // Snov.io uses OAuth — simplified domain search
    const { data } = await axios.get('https://api.snov.io/v1/get-domain-emails-count', {
        params: { domain, access_token: config.apis.snov.key },
        timeout: 10000,
    });

    if (data?.webmail === false && data?.result > 0) {
        // Get actual emails
        const { data: emailData } = await axios.get('https://api.snov.io/v2/domain-emails-with-info', {
            params: { domain, type: 'all', limit: 10, access_token: config.apis.snov.key },
            timeout: 10000,
        });

        return (emailData?.emails || []).map(e => ({
            email: e.email,
            name: [e.firstName, e.lastName].filter(Boolean).join(' ') || null,
            role: e.position || null,
        }));
    }

    return [];
}

// ═════════════════════════════════════════════
//  Step 4: Pattern-based guessing
// ═════════════════════════════════════════════

function generateCommonPatterns(domain) {
    const patterns = [
        'info', 'contact', 'admin', 'editor',
        'hello', 'support', 'webmaster', 'press',
        'partnerships', 'marketing', 'content',
    ];

    return patterns.map(prefix => ({
        email: `${prefix}@${domain}`,
        role: prefix,
    }));
}

// ═════════════════════════════════════════════
//  Validation
// ═════════════════════════════════════════════

function isValidEmail(email) {
    if (!email || email.length > 254) return false;
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!regex.test(email)) return false;

    // Skip common junk patterns
    const junk = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon',
        'postmaster', 'abuse@', 'example.com', 'test.com'];
    return !junk.some(j => email.includes(j));
}

module.exports = { startEmailFinderWorker };
