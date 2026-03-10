/**
 * Universal Tiered Blacklist Filter
 * 
 * Prevents universally massive tech/social/aggregator sites from inflating Opportunity pipelines.
 * Instead of a binary drop, it applies graduated penalties.
 */

// Tier 1: Complete Junk / Social Mega-Sites -> 0x multiplier
const tier1 = new Set([
    'google.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com',
    'tiktok.com', 'youtube.com', 'apple.com', 'microsoft.com', 'amazon.com',
    'twitter.com', 'whatsapp.com', 't.me', 'telegram.org', 'wikipedia.org', "x.com",
]);

// Tier 2: UGC / Directories / Forums -> 0.2x multiplier
const tier2 = new Set([
    'reddit.com', 'quora.com', 'yellowpages.com', 'yelp.com', 'tripadvisor.com',
    'glassdoor.com', 'indeed.com', 'pinterest.com', 'tumblr.com', 'imgur.com',
    'medium.com', 'vimeo.com', 'dailymotion.com', 'yahoo.com', 'bing.com'
]);

// Tier 3: Broad News / PR Aggregators -> 0.5x multiplier
const tier3 = new Set([
    'forbes.com', 'nytimes.com', 'wsj.com', 'washingtonpost.com', 'cnn.com',
    'bbc.co.uk', 'reuters.com', 'bloomberg.com', 'huffpost.com', 'buzzfeed.com',
    'prnewswire.com', 'businesswire.com', 'globenewswire.com'
]);

/**
 * Returns a penalty multiplier between 0 and 1.
 * 1.0 means no penalty. 0.0 means complete block.
 * @param {string} domain - Normalized domain
 * @returns {number}
 */
function getBlacklistMultiplier(domain) {
    if (!domain) return 1.0;

    // Exact match or subdomain match
    const parts = domain.split('.');
    let baseDomain = domain;

    // Simple tld extraction (e.g. news.google.com -> google.com)
    if (parts.length > 2) {
        baseDomain = parts.slice(-2).join('.');
    }

    if (tier1.has(domain) || tier1.has(baseDomain)) return 0.0;
    if (tier2.has(domain) || tier2.has(baseDomain)) return 0.2;
    if (tier3.has(domain) || tier3.has(baseDomain)) return 0.5;

    return 1.0;
}

module.exports = {
    getBlacklistMultiplier
};
