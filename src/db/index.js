const { Pool } = require('pg');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('database');

const pool = new Pool(config.db);

pool.on('connect', () => log.debug('new DB connection'));
pool.on('error', (err) => log.error({ err }, 'unexpected DB pool error'));

/**
 * Run a query against the database.
 * @param {string} text - SQL query
 * @param {Array} [params] - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  log.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'query');
  return result;
}

/**
 * Get a client from the pool for transactions.
 */
async function getClient() {
  return pool.connect();
}

/**
 * Initialize the database schema — creates tables if they don't exist.
 */
async function initializeDatabase() {
  log.info('initializing database schema...');

  // ─── Campaigns table (NEW) ───
  await query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id              SERIAL PRIMARY KEY,
      target_domain   VARCHAR(255) NOT NULL,
      keywords        TEXT[] NOT NULL,
      status          VARCHAR(30) DEFAULT 'running',
      created_at      TIMESTAMP DEFAULT NOW(),
      completed_at    TIMESTAMP
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS domains (
      id              SERIAL PRIMARY KEY,
      domain          VARCHAR(255) NOT NULL,
      normalized      VARCHAR(255) NOT NULL,
      tranco_rank     INTEGER,
      whois_age_days  INTEGER,
      page_rank       REAL,
      quality_score   REAL DEFAULT 0,
      is_competitor   BOOLEAN DEFAULT FALSE,
      category        VARCHAR(100),
      campaign_id     INTEGER REFERENCES campaigns(id),
      first_seen      TIMESTAMP DEFAULT NOW(),
      last_updated    TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS backlinks (
      id              SERIAL PRIMARY KEY,
      from_domain     VARCHAR(255) NOT NULL,
      to_domain       VARCHAR(255) NOT NULL,
      from_url        TEXT,
      to_url          TEXT,
      anchor_text     TEXT,
      source          VARCHAR(50) DEFAULT 'commoncrawl',
      campaign_id     INTEGER REFERENCES campaigns(id),
      discovered_at   TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id              SERIAL PRIMARY KEY,
      domain          VARCHAR(255) NOT NULL,
      page_url        TEXT,
      opportunity_type VARCHAR(50),
      score           REAL DEFAULT 0,
      contact_email   VARCHAR(255),
      contact_source  VARCHAR(50),
      status          VARCHAR(30) DEFAULT 'new',
      notes           TEXT,
      campaign_id     INTEGER REFERENCES campaigns(id),
      created_at      TIMESTAMP DEFAULT NOW(),
      updated_at      TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id              SERIAL PRIMARY KEY,
      domain          VARCHAR(255) NOT NULL,
      email           VARCHAR(255),
      name            VARCHAR(255),
      role            VARCHAR(100),
      source          VARCHAR(50),
      verified        BOOLEAN DEFAULT FALSE,
      campaign_id     INTEGER REFERENCES campaigns(id),
      discovered_at   TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS broken_links (
      id              SERIAL PRIMARY KEY,
      source_page     TEXT NOT NULL,
      source_domain   VARCHAR(255) NOT NULL,
      broken_url      TEXT NOT NULL,
      anchor_text     TEXT,
      http_status     INTEGER,
      campaign_id     INTEGER REFERENCES campaigns(id),
      discovered_at   TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS crawl_history (
      id              SERIAL PRIMARY KEY,
      url             TEXT NOT NULL,
      domain          VARCHAR(255),
      http_status     INTEGER,
      content_type    VARCHAR(100),
      response_time   INTEGER,
      campaign_id     INTEGER REFERENCES campaigns(id),
      crawled_at      TIMESTAMP DEFAULT NOW(),
      error           TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS system_metrics (
      id              SERIAL PRIMARY KEY,
      metric_name     VARCHAR(100) NOT NULL,
      metric_value    REAL NOT NULL,
      labels          JSONB DEFAULT '{}',
      campaign_id     INTEGER REFERENCES campaigns(id),
      recorded_at     TIMESTAMP DEFAULT NOW()
    );
  `);

  // ─── Add campaign_id to existing tables (safe migration for existing data) ───
  const migrations = [
    'ALTER TABLE domains ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE backlinks ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE broken_links ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE crawl_history ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    'ALTER TABLE system_metrics ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id)',
    // Add AI & Intersect scoring columns to opportunities
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS competitor_intersect_count INTEGER DEFAULT 0',
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS ai_outreach_hook TEXT',
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS ai_relevance_score INTEGER',
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS link_intent VARCHAR(50)',
    'ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS anchor_context TEXT',
    // Remove old UNIQUE constraints that conflict with campaign isolation
    'ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_domain_key',
    'ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_normalized_key',
    'ALTER TABLE backlinks DROP CONSTRAINT IF EXISTS backlinks_from_domain_to_domain_from_url_key',
    // Add campaign-scoped unique constraints
    'ALTER TABLE domains ADD CONSTRAINT domains_normalized_campaign_key UNIQUE (normalized, campaign_id)',
    'ALTER TABLE contacts ADD CONSTRAINT contacts_domain_email_campaign_key UNIQUE (domain, email, campaign_id)',
    'ALTER TABLE broken_links ADD CONSTRAINT broken_links_source_broken_campaign_key UNIQUE (source_page, broken_url, campaign_id)',
    'ALTER TABLE backlinks ADD CONSTRAINT backlinks_from_to_url_campaign_key UNIQUE (from_domain, to_domain, from_url, campaign_id)'
  ];
  for (const sql of migrations) {
    try { await query(sql); } catch { /* already exists or not applicable */ }
  }

  // ─── Indexes ───
  await query(`CREATE INDEX IF NOT EXISTS idx_campaigns_domain ON campaigns(target_domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_domains_campaign ON domains(campaign_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_backlinks_campaign ON backlinks(campaign_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_campaign ON opportunities(campaign_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_campaign ON contacts(campaign_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_backlinks_to_domain ON backlinks(to_domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_backlinks_from_domain ON backlinks(from_domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_domains_score ON domains(quality_score DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_domains_competitor ON domains(is_competitor) WHERE is_competitor = TRUE;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_domain ON contacts(domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_broken_links_domain ON broken_links(source_domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crawl_history_domain ON crawl_history(domain);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON system_metrics(metric_name, recorded_at);`);

  log.info('database schema initialized');
}

/**
 * Create a new campaign.
 * @param {string} targetDomain
 * @param {string[]} keywords
 * @returns {Promise<{id: number}>}
 */
async function createCampaign(targetDomain, keywords) {
  const { rows } = await query(
    `INSERT INTO campaigns (target_domain, keywords) VALUES ($1, $2) RETURNING id`,
    [targetDomain, keywords]
  );
  return rows[0];
}

/**
 * Mark a campaign as completed.
 */
async function completeCampaign(campaignId) {
  await query(
    `UPDATE campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [campaignId]
  );
}

/**
 * Record a system metric.
 */
async function recordMetric(name, value, labels = {}, campaignId = null) {
  await query(
    `INSERT INTO system_metrics (metric_name, metric_value, labels, campaign_id) VALUES ($1, $2, $3, $4)`,
    [name, value, JSON.stringify(labels), campaignId]
  );
}

/**
 * Check database connectivity.
 */
async function checkConnection() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  pool,
  query,
  getClient,
  initializeDatabase,
  createCampaign,
  completeCampaign,
  recordMetric,
  checkConnection,
};
