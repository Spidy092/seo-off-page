/**
 * 🔍 Enhanced Competitor Analyzer Service
 * 
 * Deep competitor analysis with scoring, insights, and recommendations.
 * Uses free APIs and scraping to gather competitive intelligence.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const config = require('../config');

const log = createLogger('competitor-analyzer');

// ─── Constants ───
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ─── Domain Authority Estimation ───
async function estimateDomainAuthority(domain) {
    const signals = {
        backlinks: 0,
        referringDomains: 0,
        organicKeywords: 0,
        trustFlow: 0,
        citationFlow: 0,
    };

    try {
        // 1. OpenPageRank (Free - 33k/day)
        const oprResponse = await axios.get(`https://openpagerank.com/api/v1.0/getPageRank?domains%5B0%5D=${domain}`, {
            headers: { 'API-OPR': config.apis.openPageRank.key },
            timeout: 5000,
        });
        
        if (oprResponse.data?.response?.[0]?.page_rank_integer) {
            signals.trustFlow = oprResponse.data.response[0].page_rank_integer * 10; // Scale 0-100
        }
    } catch (err) {
        log.debug({ domain, err: err.message }, 'OpenPageRank failed');
    }

    try {
        // 2. Wayback Machine - Domain age
        const waybackResponse = await axios.get(`https://archive.org/wayback/available?url=${domain}`, { timeout: 5000 });
        if (waybackResponse.data?.archived_snapshots?.closest?.timestamp) {
            const firstSeen = new Date(waybackResponse.data.archived_snapshots.closest.timestamp.slice(0, 4) + '-01-01');
            const ageYears = (Date.now() - firstSeen.getTime()) / (365 * 24 * 60 * 60 * 1000);
            signals.domainAge = Math.min(ageYears, 20); // Cap at 20 years
        }
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Wayback check failed');
    }

    try {
        // 3. Common Crawl Index - Estimate backlinks
        const ccResponse = await axios.get(`https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=${domain}/*&output=json&limit=100`, { timeout: 10000 });
        if (ccResponse.data) {
            const lines = ccResponse.data.split('\n').filter(Boolean);
            signals.indexedPages = lines.length;
        }
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Common Crawl check failed');
    }

    // Calculate composite DA score (0-100)
    const daScore = Math.min(100, Math.round(
        (signals.trustFlow * 0.4) +
        (Math.min(signals.indexedPages || 0, 1000) / 10) +
        (Math.min(signals.domainAge || 0, 20) * 2)
    ));

    return { daScore, signals };
}

// ─── Traffic Estimation ───
async function estimateTraffic(domain) {
    try {
        // Use SimilarWeb free tier or estimate from SERP presence
        const searchUrl = `https://www.google.com/search?q=site:${domain}`;
        const response = await axios.get(searchUrl, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 5000,
        });

        const $ = cheerio.load(response.data);
        const resultStats = $('#result-stats').text();
        
        // Extract approximate indexed pages
        const match = resultStats.match(/[\d,]+/);
        const indexedPages = match ? parseInt(match[0].replace(/,/g, '')) : 0;

        // Rough traffic estimate based on indexed pages
        const estimatedMonthlyVisits = Math.round(indexedPages * 0.1); // Very rough estimate

        return {
            indexedPages,
            estimatedMonthlyVisits,
            confidence: 'low', // This is a rough estimate
        };
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Traffic estimation failed');
        return { indexedPages: 0, estimatedMonthlyVisits: 0, confidence: 'none' };
    }
}

// ─── Top Pages Analysis ───
async function analyzeTopPages(domain, keywords = []) {
    const topPages = [];

    try {
        // Search for site's top content
        const queries = [
            `site:${domain}`,
            ...keywords.slice(0, 3).map(kw => `site:${domain} ${kw}`),
        ];

        for (const query of queries) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': getRandomUA() },
                timeout: 5000,
            });

            const $ = cheerio.load(response.data);
            
            $('div.g').each((i, el) => {
                const link = $(el).find('a').attr('href');
                const title = $(el).find('h3').text();
                const snippet = $(el).find('span.aCOpRe, div.VwiC3b').text();

                if (link && link.includes(domain)) {
                    topPages.push({
                        url: link,
                        title,
                        snippet,
                        estimatedTraffic: 'medium', // Placeholder
                    });
                }
            });

            await new Promise(r => setTimeout(r, 2000)); // Rate limit
        }
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Top pages analysis failed');
    }

    // Deduplicate by URL
    const uniquePages = [...new Map(topPages.map(p => [p.url, p])).values()];
    return uniquePages.slice(0, 20); // Top 20 pages
}

// ─── Content Strategy Analysis ───
async function analyzeContentStrategy(domain) {
    try {
        const response = await axios.get(`https://${domain}`, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 10000,
            maxRedirects: 5,
        });

        const $ = cheerio.load(response.data);
        
        // Analyze content patterns
        const analysis = {
            hasBlog: false,
            hasResources: false,
            hasCaseStudies: false,
            hasGuides: false,
            contentTypes: [],
            topics: [],
            publishingFrequency: 'unknown',
        };

        // Check for blog
        const blogLinks = $('a[href*="/blog"], a[href*="/articles"], a[href*="/resources"]');
        analysis.hasBlog = blogLinks.length > 0;

        // Check for resource pages
        const resourceLinks = $('a[href*="/resources"], a[href*="/guides"], a[href*="/tools"]');
        analysis.hasResources = resourceLinks.length > 0;

        // Extract topics from navigation and headings
        $('nav a, h1, h2, h3').each((i, el) => {
            const text = $(el).text().trim().toLowerCase();
            if (text.length > 3 && text.length < 50) {
                analysis.topics.push(text);
            }
        });

        // Deduplicate topics
        analysis.topics = [...new Set(analysis.topics)].slice(0, 20);

        // Detect content types
        if ($('video, iframe[src*="youtube"]').length > 0) analysis.contentTypes.push('video');
        if ($('img').length > 10) analysis.contentTypes.push('image-heavy');
        if ($('table').length > 2) analysis.contentTypes.push('data-tables');
        if ($('ul, ol').length > 5) analysis.contentTypes.push('listicles');

        return analysis;
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Content strategy analysis failed');
        return { hasBlog: false, hasResources: false, topics: [], contentTypes: [] };
    }
}

// ─── Social Media Presence ───
async function analyzeSocialPresence(domain) {
    const socialPlatforms = {
        twitter: { found: false, url: null },
        linkedin: { found: false, url: null },
        facebook: { found: false, url: null },
        instagram: { found: false, url: null },
        youtube: { found: false, url: null },
    };

    try {
        const response = await axios.get(`https://${domain}`, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 10000,
        });

        const $ = cheerio.load(response.data);
        
        // Find social links
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href')?.toLowerCase() || '';
            
            if (href.includes('twitter.com/') || href.includes('x.com/')) {
                socialPlatforms.twitter = { found: true, url: href };
            }
            if (href.includes('linkedin.com/')) {
                socialPlatforms.linkedin = { found: true, url: href };
            }
            if (href.includes('facebook.com/')) {
                socialPlatforms.facebook = { found: true, url: href };
            }
            if (href.includes('instagram.com/')) {
                socialPlatforms.instagram = { found: true, url: href };
            }
            if (href.includes('youtube.com/')) {
                socialPlatforms.youtube = { found: true, url: href };
            }
        });

        return socialPlatforms;
    } catch (err) {
        log.debug({ domain, err: err.message }, 'Social presence analysis failed');
        return socialPlatforms;
    }
}

// ─── Keyword Gap Analysis ───
async function analyzeKeywordGaps(targetDomain, competitorDomain, keywords) {
    const gaps = {
        competitorOnly: [],
        targetOnly: [],
        shared: [],
        opportunities: [],
    };

    try {
        // Search for competitor rankings
        for (const keyword of keywords.slice(0, 10)) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=20`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': getRandomUA() },
                timeout: 5000,
            });

            const $ = cheerio.load(response.data);
            let targetRank = null;
            let competitorRank = null;

            $('div.g').each((i, el) => {
                const link = $(el).find('a').attr('href') || '';
                const rank = i + 1;

                if (link.includes(targetDomain)) {
                    targetRank = rank;
                }
                if (link.includes(competitorDomain)) {
                    competitorRank = rank;
                }
            });

            if (competitorRank && !targetRank) {
                gaps.competitorOnly.push({ keyword, competitorRank });
                gaps.opportunities.push({
                    keyword,
                    difficulty: competitorRank <= 5 ? 'hard' : competitorRank <= 10 ? 'medium' : 'easy',
                    reason: `Competitor ranks #${competitorRank}, you don't rank`,
                });
            } else if (targetRank && !competitorRank) {
                gaps.targetOnly.push({ keyword, targetRank });
            } else if (targetRank && competitorRank) {
                gaps.shared.push({ keyword, targetRank, competitorRank });
            }

            await new Promise(r => setTimeout(r, 2000)); // Rate limit
        }
    } catch (err) {
        log.debug({ err: err.message }, 'Keyword gap analysis failed');
    }

    return gaps;
}

// ─── Competitor Scoring ───
function calculateCompetitorScore(analysis) {
    const weights = {
        domainAuthority: 0.25,
        traffic: 0.20,
        contentQuality: 0.20,
        backlinks: 0.20,
        socialPresence: 0.15,
    };

    const scores = {
        domainAuthority: analysis.domainAuthority?.daScore || 0,
        traffic: Math.min(100, (analysis.traffic?.estimatedMonthlyVisits || 0) / 1000),
        contentQuality: (analysis.contentStrategy?.hasBlog ? 25 : 0) +
                       (analysis.contentStrategy?.hasResources ? 25 : 0) +
                       (analysis.contentStrategy?.topics?.length || 0) * 2.5,
        backlinks: Math.min(100, (analysis.domainAuthority?.signals?.indexedPages || 0) / 10),
        socialPresence: Object.values(analysis.socialPresence || {}).filter(s => s.found).length * 20,
    };

    const totalScore = Object.entries(weights).reduce((sum, [key, weight]) => {
        return sum + (scores[key] * weight);
    }, 0);

    // Determine threat level
    let threatLevel;
    if (totalScore >= 70) threatLevel = 'HIGH';
    else if (totalScore >= 40) threatLevel = 'MEDIUM';
    else threatLevel = 'LOW';

    return {
        totalScore: Math.round(totalScore),
        breakdown: scores,
        threatLevel,
    };
}

// ─── Generate Recommendations ───
function generateRecommendations(analysis) {
    const recommendations = [];

    // Content recommendations
    if (!analysis.contentStrategy?.hasBlog && analysis.competitor?.contentStrategy?.hasBlog) {
        recommendations.push({
            priority: 'HIGH',
            category: 'content',
            action: 'Start a blog',
            reason: 'Competitor has blog, you don\'t - missing content opportunities',
        });
    }

    if (analysis.keywordGaps?.opportunities?.length > 0) {
        const easyWins = analysis.keywordGaps.opportunities.filter(o => o.difficulty === 'easy');
        if (easyWins.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'keywords',
                action: `Target ${easyWins.length} easy-win keywords`,
                keywords: easyWins.map(k => k.keyword).slice(0, 5),
                reason: 'Competitor ranks but poorly - opportunity to outrank',
            });
        }
    }

    // Social recommendations
    const competitorSocials = Object.entries(analysis.competitor?.socialPresence || {})
        .filter(([_, v]) => v.found).map(([k]) => k);
    const targetSocials = Object.entries(analysis.socialPresence || {})
        .filter(([_, v]) => v.found).map(([k]) => k);
    
    const missingSocials = competitorSocials.filter(s => !targetSocials.includes(s));
    if (missingSocials.length > 0) {
        recommendations.push({
            priority: 'MEDIUM',
            category: 'social',
            action: `Add presence on: ${missingSocials.join(', ')}`,
            reason: 'Competitor active on platforms you\'re missing',
        });
    }

    // Backlink recommendations
    if (analysis.domainAuthority?.daScore < analysis.competitor?.domainAuthority?.daScore) {
        recommendations.push({
            priority: 'HIGH',
            category: 'backlinks',
            action: 'Focus on link building',
            reason: `Competitor DA (${analysis.competitor.domainAuthority.daScore}) > Your DA (${analysis.domainAuthority.daScore})`,
        });
    }

    return recommendations;
}

// ─── Main Analysis Function ───
async function analyzeCompetitor(targetDomain, competitorDomain, keywords = []) {
    log.info({ targetDomain, competitorDomain }, 'starting deep competitor analysis');

    const analysis = {
        target: targetDomain,
        competitor: competitorDomain,
        timestamp: new Date().toISOString(),
    };

    // Run analyses in parallel where possible
    const [domainAuthority, traffic, topPages, contentStrategy, socialPresence] = await Promise.all([
        estimateDomainAuthority(competitorDomain),
        estimateTraffic(competitorDomain),
        analyzeTopPages(competitorDomain, keywords),
        analyzeContentStrategy(competitorDomain),
        analyzeSocialPresence(competitorDomain),
    ]);

    analysis.domainAuthority = domainAuthority;
    analysis.traffic = traffic;
    analysis.topPages = topPages;
    analysis.contentStrategy = contentStrategy;
    analysis.socialPresence = socialPresence;

    // Keyword gap analysis (sequential to avoid rate limits)
    analysis.keywordGaps = await analyzeKeywordGaps(targetDomain, competitorDomain, keywords);

    // Calculate scores
    analysis.score = calculateCompetitorScore(analysis);

    // Generate recommendations
    analysis.recommendations = generateRecommendations(analysis);

    log.info({ 
        competitor: competitorDomain, 
        score: analysis.score.totalScore,
        threatLevel: analysis.score.threatLevel,
        recommendations: analysis.recommendations.length,
    }, 'competitor analysis complete');

    return analysis;
}

// ─── Batch Analysis ───
async function analyzeCompetitors(targetDomain, competitorDomains, keywords = []) {
    const results = [];

    for (const competitor of competitorDomains) {
        try {
            const analysis = await analyzeCompetitor(targetDomain, competitor, keywords);
            results.push(analysis);
            
            // Rate limit between competitors
            await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
            log.error({ competitor, err: err.message }, 'competitor analysis failed');
            results.push({ competitor, error: err.message });
        }
    }

    // Sort by threat level
    results.sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0));

    return {
        target: targetDomain,
        analyzedAt: new Date().toISOString(),
        totalCompetitors: results.length,
        competitors: results,
        summary: generateSummary(results),
    };
}

// ─── Summary Generation ───
function generateSummary(results) {
    const validResults = results.filter(r => r.score);
    
    if (validResults.length === 0) {
        return { error: 'No valid competitor analyses' };
    }

    const avgScore = validResults.reduce((sum, r) => sum + r.score.totalScore, 0) / validResults.length;
    const highThreat = validResults.filter(r => r.score.threatLevel === 'HIGH').length;
    const mediumThreat = validResults.filter(r => r.score.threatLevel === 'MEDIUM').length;
    const lowThreat = validResults.filter(r => r.score.threatLevel === 'LOW').length;

    // Aggregate all recommendations
    const allRecommendations = validResults.flatMap(r => r.recommendations || []);
    const topRecommendations = allRecommendations
        .filter(r => r.priority === 'HIGH')
        .slice(0, 10);

    // Aggregate keyword opportunities
    const allKeywordOpportunities = validResults.flatMap(r => r.keywordGaps?.opportunities || []);
    const uniqueOpportunities = [...new Map(allKeywordOpportunities.map(o => [o.keyword, o])).values()];

    return {
        averageCompetitorScore: Math.round(avgScore),
        threatDistribution: { high: highThreat, medium: mediumThreat, low: lowThreat },
        topThreats: validResults.filter(r => r.score.threatLevel === 'HIGH').map(r => r.competitor).slice(0, 5),
        topRecommendations,
        keywordOpportunities: uniqueOpportunities.slice(0, 20),
        totalOpportunities: uniqueOpportunities.length,
    };
}

module.exports = {
    analyzeCompetitor,
    analyzeCompetitors,
    estimateDomainAuthority,
    estimateTraffic,
    analyzeTopPages,
    analyzeContentStrategy,
    analyzeSocialPresence,
    analyzeKeywordGaps,
};
