const axios = require('axios');
const zlib = require('zlib');
const readline = require('readline');
const { createLogger } = require('../utils/logger');
const { normalizeDomain } = require('../utils/normalizer');
const db = require('../db');

const log = createLogger('common-crawl');

/**
 * Common Crawl Web Graph Ingestion Service
 *
 * Streams compressed web graph files from Common Crawl CDN,
 * filters for target domains, and batch-inserts into PostgreSQL.
 *
 * Memory stays constant (~50MB) regardless of file size.
 */

// Common Crawl base URL for web graph data
const CC_BASE_URL = 'https://data.commoncrawl.org';

/**
 * Get the latest available web graph dataset URLs.
 * Common Crawl publishes monthly at:
 *   https://data.commoncrawl.org/projects/hyperlinkgraph/{crawl-id}/
 *
 * We fetch the host-level graph (smaller, domain-level relationships).
 * @returns {Promise<string[]>} List of graph file URLs
 */
async function getLatestGraphIndex() {
    try {
        // Common Crawl lists available datasets at this endpoint
        const indexUrl = 'https://index.commoncrawl.org/collinfo.json';
        const { data: collections } = await axios.get(indexUrl, { timeout: 15000 });

        // Get the most recent crawl ID
        const latestCrawl = collections[0];
        const crawlId = latestCrawl['id']; // e.g., "CC-MAIN-2025-05"

        log.info({ crawlId, name: latestCrawl.name }, 'latest Common Crawl identified');

        // Web graph file pattern
        // Host-level graph files are split into segments
        // Format: projects/hyperlinkgraph/{crawlId}/host/cc-main-{date}-host-ranks.txt.gz
        return {
            crawlId,
            // We'll use the vertices (nodes) and edges files
            verticesPattern: `${CC_BASE_URL}/projects/hyperlinkgraph/${crawlId}/host/cc-main-host-vertices.txt.gz`,
            edgesPattern: `${CC_BASE_URL}/projects/hyperlinkgraph/${crawlId}/host/cc-main-host-edges.txt.gz`,
        };
    } catch (err) {
        log.error({ err: err.message }, 'failed to fetch Common Crawl index');
        throw err;
    }
}

/**
 * Stream and filter a compressed web graph file.
 *
 * @param {string} url - URL to the .gz graph file
 * @param {Set<string>} targetDomains - Domains to filter for (as "to" target)
 * @param {object} [options]
 * @param {number} [options.batchSize=1000] - Rows per batch INSERT
 * @param {Function} [options.onProgress] - Progress callback({ processed, matched, elapsed })
 * @returns {Promise<{ processed: number, matched: number }>}
 */
async function streamAndFilter(url, targetDomains, options = {}) {
    const { batchSize = 1000, onProgress } = options;

    log.info({ url, targetCount: targetDomains.size }, 'starting Common Crawl stream');

    const response = await axios({
        url,
        responseType: 'stream',
        timeout: 30000,
        headers: { 'Accept-Encoding': 'identity' }, // we'll decompress ourselves
    });

    const gunzip = zlib.createGunzip();
    const rl = readline.createInterface({
        input: response.data.pipe(gunzip),
        crlfDelay: Infinity,
    });

    let batch = [];
    let processed = 0;
    let matched = 0;
    const startTime = Date.now();

    for await (const line of rl) {
        // Skip comments and empty lines
        if (!line || line.startsWith('#')) continue;

        processed++;

        // Format: from_host<TAB>to_host (or with additional columns)
        const parts = line.split('\t');
        if (parts.length < 2) continue;

        const fromHost = normalizeDomain(parts[0]);
        const toHost = normalizeDomain(parts[1]);

        // Filter: keep only rows where the "to" domain is in our target set
        if (targetDomains.has(toHost)) {
            matched++;
            batch.push({ from_domain: fromHost, to_domain: toHost });

            if (batch.length >= batchSize) {
                await batchInsertBacklinks(batch);
                batch = [];
            }
        }

        // Progress reporting every 100K lines
        if (processed % 100000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log.info({ processed, matched, elapsed: `${elapsed}s` }, 'stream progress');
            if (onProgress) onProgress({ processed, matched, elapsed });
        }
    }

    // Flush remaining batch
    if (batch.length > 0) {
        await batchInsertBacklinks(batch);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info({ processed, matched, elapsed: `${elapsed}s` }, 'Common Crawl stream complete');

    // Record metric
    await db.recordMetric('commoncrawl_processed', processed);
    await db.recordMetric('commoncrawl_matched', matched);

    return { processed, matched };
}

/**
 * Batch insert backlinks into PostgreSQL with ON CONFLICT DO NOTHING.
 * @param {Array<{from_domain: string, to_domain: string}>} rows
 */
async function batchInsertBacklinks(rows) {
    if (rows.length === 0) return;

    // Build multi-row INSERT
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    for (const row of rows) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, 'commoncrawl')`);
        values.push(row.from_domain, row.to_domain);
        paramIndex += 2;
    }

    const sql = `
    INSERT INTO backlinks (from_domain, to_domain, source)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (from_domain, to_domain, from_url, campaign_id)
    DO NOTHING
  `;

    try {
        await db.query(sql, values);
    } catch (err) {
        log.error({ err: err.message, batchSize: rows.length }, 'batch insert failed');
        // Fallback: insert one by one
        for (const row of rows) {
            try {
                await db.query(
                    `INSERT INTO backlinks (from_domain, to_domain, source)
           VALUES ($1, $2, 'commoncrawl')
           ON CONFLICT (from_domain, to_domain, from_url, campaign_id) DO NOTHING`,
                    [row.from_domain, row.to_domain]
                );
            } catch (singleErr) {
                log.error({ err: singleErr.message, from: row.from_domain }, 'single insert failed');
            }
        }
    }
}

/**
 * Full ingestion: get target domains from DB, stream and filter Common Crawl data.
 * This is the main entry point called by the BullMQ worker.
 */
async function runIngestion() {
    log.info('starting full Common Crawl ingestion');

    // 1. Get all competitor domains + target domains from DB
    const { rows: domains } = await db.query(
        `SELECT DISTINCT normalized FROM domains WHERE is_competitor = TRUE`
    );

    if (domains.length === 0) {
        log.warn('no competitor domains found — skipping ingestion');
        return { processed: 0, matched: 0, skipped: true };
    }

    const targetDomains = new Set(domains.map(d => d.normalized));
    log.info({ targetCount: targetDomains.size }, 'loaded target domains');

    // 2. Get latest Common Crawl graph info
    const graphInfo = await getLatestGraphIndex();

    // 3. Stream and filter the edges file
    const result = await streamAndFilter(graphInfo.edgesPattern, targetDomains);

    log.info({ ...result, crawlId: graphInfo.crawlId }, 'ingestion complete');
    return result;
}

module.exports = {
    getLatestGraphIndex,
    streamAndFilter,
    batchInsertBacklinks,
    runIngestion,
};
