-- 📊 Competitor Analyses Table Migration
-- Run this to add support for storing competitor analysis results

-- ─── Competitor Analyses Table ───
CREATE TABLE IF NOT EXISTS competitor_analyses (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL,
    target_domain VARCHAR(255) NOT NULL,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_competitor_analyses_campaign ON competitor_analyses(campaign_id);
CREATE INDEX IF NOT EXISTS idx_competitor_analyses_created ON competitor_analyses(created_at);

-- ─── Competitor Scores Table (for quick lookups) ───
CREATE TABLE IF NOT EXISTS competitor_scores (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    da_score INTEGER DEFAULT 0,
    traffic_estimate INTEGER DEFAULT 0,
    content_score INTEGER DEFAULT 0,
    social_score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    threat_level VARCHAR(20) DEFAULT 'LOW',
    analyzed_at TIMESTAMP DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_competitor_score UNIQUE (campaign_id, domain),
    CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_competitor_scores_campaign ON competitor_scores(campaign_id);
CREATE INDEX IF NOT EXISTS idx_competitor_scores_domain ON competitor_scores(domain);
CREATE INDEX IF NOT EXISTS idx_competitor_scores_threat ON competitor_scores(threat_level);

-- ─── Keyword Opportunities Table ───
CREATE TABLE IF NOT EXISTS keyword_opportunities (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL,
    competitor_domain VARCHAR(255) NOT NULL,
    keyword VARCHAR(500) NOT NULL,
    difficulty VARCHAR(20) DEFAULT 'medium',
    competitor_rank INTEGER,
    reason TEXT,
    discovered_at TIMESTAMP DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_keyword_opp UNIQUE (campaign_id, competitor_domain, keyword),
    CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_keyword_opps_campaign ON keyword_opportunities(campaign_id);
CREATE INDEX IF NOT EXISTS idx_keyword_opps_difficulty ON keyword_opportunities(difficulty);

-- ─── Recommendations Table ───
CREATE TABLE IF NOT EXISTS competitor_recommendations (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    keywords TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_recommendations_campaign ON competitor_recommendations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_priority ON competitor_recommendations(priority);

-- ─── Add columns to existing domains table ───
ALTER TABLE domains ADD COLUMN IF NOT EXISTS da_score INTEGER DEFAULT 0;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS threat_level VARCHAR(20) DEFAULT 'UNKNOWN';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_analyzed TIMESTAMP;

-- ─── View: Top Competitors by Threat ───
CREATE OR REPLACE VIEW top_competitors AS
SELECT 
    cs.campaign_id,
    cs.domain,
    cs.total_score,
    cs.threat_level,
    cs.da_score,
    cs.analyzed_at,
    d.created_at as discovered_at
FROM competitor_scores cs
JOIN domains d ON cs.domain = d.normalized AND cs.campaign_id = d.campaign_id
WHERE d.is_competitor = TRUE
ORDER BY cs.total_score DESC;

-- ─── View: Easy Win Keywords ───
CREATE OR REPLACE VIEW easy_win_keywords AS
SELECT 
    campaign_id,
    keyword,
    competitor_domain,
    competitor_rank,
    reason
FROM keyword_opportunities
WHERE difficulty = 'easy'
ORDER BY competitor_rank ASC;

-- ─── Function: Get Campaign Summary ───
CREATE OR REPLACE FUNCTION get_campaign_competitor_summary(p_campaign_id VARCHAR)
RETURNS TABLE (
    total_competitors BIGINT,
    high_threat_count BIGINT,
    medium_threat_count BIGINT,
    low_threat_count BIGINT,
    avg_da_score NUMERIC,
    total_keyword_opportunities BIGINT,
    easy_win_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT cs.domain) as total_competitors,
        COUNT(DISTINCT CASE WHEN cs.threat_level = 'HIGH' THEN cs.domain END) as high_threat_count,
        COUNT(DISTINCT CASE WHEN cs.threat_level = 'MEDIUM' THEN cs.domain END) as medium_threat_count,
        COUNT(DISTINCT CASE WHEN cs.threat_level = 'LOW' THEN cs.domain END) as low_threat_count,
        AVG(cs.da_score) as avg_da_score,
        (SELECT COUNT(*) FROM keyword_opportunities WHERE campaign_id = p_campaign_id) as total_keyword_opportunities,
        (SELECT COUNT(*) FROM keyword_opportunities WHERE campaign_id = p_campaign_id AND difficulty = 'easy') as easy_win_count
    FROM competitor_scores cs
    WHERE cs.campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;
