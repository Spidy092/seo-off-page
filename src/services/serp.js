const axios = require('axios');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('serp');

/**
 * Multi-source SERP (Search Engine Results Page) service.
 *
 * Fallback chain:
 *   1. Serper.dev (2500/mo free)
 *   2. DuckDuckGo HTML (unlimited, rate-limited)
 *   3. Google Custom Search API (100/day free)
 *
 * All methods return a normalized array of { title, url, snippet }.
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string} source - Which SERP engine returned this
 */

/**
 * Search using the fallback chain.
 * @param {string} query - Search query
 * @param {number} [numResults=10] - Number of results
 * @param {object} deps - Dependencies { rateLimiter }
 * @returns {Promise<SearchResult[]>}
 */
async function search(query, numResults = 10, deps = {}) {
    const { rateLimiter } = deps;

    // ─── Source 1: Serper.dev ───
    if (config.apis.serper.key) {
        const hasQuota = rateLimiter
            ? await rateLimiter.checkQuota('serper.dev', config.apis.serper.dailyLimit)
            : true;

        if (hasQuota) {
            try {
                const results = await searchSerper(query, numResults);
                if (results.length > 0) return results;
            } catch (err) {
                log.warn({ err: err.message, source: 'serper' }, 'serper failed, falling back');
            }
        } else {
            log.info('serper quota exhausted, falling back');
        }
    }

    // ─── Source 2: DuckDuckGo HTML ───
    try {
        if (rateLimiter) await rateLimiter.waitForHost('html.duckduckgo.com');
        const results = await searchDuckDuckGo(query, numResults, deps);
        if (results.length > 0) return results;
    } catch (err) {
        log.warn({ err: err.message, source: 'ddg' }, 'DDG failed, falling back');
    }

    // ─── Source 3: Google Custom Search ───
    if (config.apis.googleCse.key && config.apis.googleCse.cx) {
        const hasQuota = rateLimiter
            ? await rateLimiter.checkQuota('google-cse', config.apis.googleCse.dailyLimit)
            : true;

        if (hasQuota) {
            try {
                const results = await searchGoogleCSE(query, numResults);
                if (results.length > 0) return results;
            } catch (err) {
                log.warn({ err: err.message, source: 'google-cse' }, 'Google CSE failed');
            }
        }
    }

    log.error({ query }, 'all SERP sources failed');
    return [];
}

// ═════════════════════════════════════════════
//  Serper.dev
// ═════════════════════════════════════════════

async function searchSerper(query, numResults) {
    // Serper returns 400 "Query not allowed" if we use strict quotes around the domain
    // We should strip wrapping quotes from the query for Serper.
    const cleanQuery = query.trim().replace(/^"(.+?)"(\s+-site.+)?$/, '$1$2');

    const response = await axios.post(
        'https://google.serper.dev/search',
        { q: cleanQuery, num: numResults },
        {
            headers: {
                'X-API-KEY': config.apis.serper.key,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        }
    );

    const data = response.data;
    const results = (data.organic || []).map(item => ({
        title: item.title || '',
        url: item.link || '',
        snippet: item.snippet || '',
        source: 'serper',
    }));

    log.info({ query, count: results.length, source: 'serper' }, 'SERP results');
    return results;
}

// ═════════════════════════════════════════════
//  DuckDuckGo HTML (no JS, no API key needed)
// ═════════════════════════════════════════════

async function searchDuckDuckGo(query, numResults, deps = {}) {
    const { rateLimiter } = deps;
    const cheerio = require('cheerio');

    const { data: html } = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: {
            'User-Agent': rateLimiter?.getRandomUserAgent() ||
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000,
    });

    if (rateLimiter) rateLimiter.onResponse('html.duckduckgo.com', 200);

    const $ = cheerio.load(html);
    const results = [];

    $('div.result').each((i, el) => {
        if (results.length >= numResults) return false;

        const titleEl = $(el).find('a.result__a');
        const snippetEl = $(el).find('.result__snippet');
        const href = titleEl.attr('href') || '';

        // DDG wraps URLs in a redirect — extract the actual URL
        let url = href;
        if (href.includes('uddg=')) {
            try {
                const parsed = new URL(href, 'https://duckduckgo.com');
                url = decodeURIComponent(parsed.searchParams.get('uddg') || href);
            } catch { /* use raw href */ }
        }

        if (url && !url.startsWith('https://duckduckgo.com')) {
            results.push({
                title: titleEl.text().trim(),
                url,
                snippet: snippetEl.text().trim(),
                source: 'duckduckgo',
            });
        }
    });

    log.info({ query, count: results.length, source: 'duckduckgo' }, 'SERP results');
    return results;
}

// ═════════════════════════════════════════════
//  Google Custom Search Engine API
// ═════════════════════════════════════════════

async function searchGoogleCSE(query, numResults) {
    const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
            key: config.apis.googleCse.key,
            cx: config.apis.googleCse.cx,
            q: query,
            num: Math.min(numResults, 10),
        },
        timeout: 10000,
    });

    const results = (data.items || []).map(item => ({
        title: item.title || '',
        url: item.link || '',
        snippet: item.snippet || '',
        source: 'google-cse',
    }));

    log.info({ query, count: results.length, source: 'google-cse' }, 'SERP results');
    return results;
}

module.exports = {
    search,
    searchSerper,
    searchDuckDuckGo,
    searchGoogleCSE,
};
